import { runWithConcurrency } from "@vevx/varp/lib";

import type { FileContent } from "../agents/types";
import type { AuditTaskResult, ComplianceReport, CoverageEntry } from "./findings";
import { deduplicateFindings, summarizeFindings } from "./findings";
import { generatePrompt, parseAuditResponse, AUDIT_FINDINGS_SCHEMA } from "./prompt-generator";
import { parseSuppressConfig, parseInlineSuppressions, applySuppressions } from "./suppressions";
import type { AuditPlan, AuditTask, Ruleset, ModelCaller } from "./types";

// ── Progress events ──

export type AuditProgressEvent =
  | { type: "plan-ready"; plan: AuditPlan }
  | { type: "wave-start"; wave: 1 | 2 | 3; taskCount: number }
  | { type: "task-start"; task: AuditTask }
  | { type: "task-complete"; task: AuditTask; result: AuditTaskResult }
  | { type: "task-error"; task: AuditTask; error: Error }
  | { type: "task-skipped"; task: AuditTask; reason: "budget-exceeded" }
  | { type: "wave-complete"; wave: 1 | 2 | 3; results: AuditTaskResult[] }
  | { type: "complete"; report: ComplianceReport };

export type ProgressCallback = (event: AuditProgressEvent) => void;

// ── Executor options ──

export interface ExecutorOptions {
  /** Backend-agnostic model caller. Consumers inject the implementation. */
  caller: ModelCaller;

  /** Model to use for audit tasks */
  model: string;

  /** Max tokens per API response (default: 4096) */
  maxTokens?: number;

  /** Max concurrent API calls per wave (default: 5) */
  concurrency?: number;

  /** Progress callback for UI updates */
  onProgress?: ProgressCallback;

  /** Target path for suppression config lookup */
  targetPath?: string;

  /** Diff metadata for incremental audits */
  diff?: { ref: string; changedFiles: number };

  /** Max estimated tokens to spend. Low-priority tasks skipped when exhausted. */
  budget?: number;
}

const DEFAULT_MODEL = "claude-sonnet-4-5-20250929";
const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_CONCURRENCY = 5;

// ── Task execution ──

/**
 * Execute a single audit task: generate prompt, call Claude, parse response.
 * Uses structured outputs (--json-schema) for constrained decoding when available.
 */
async function executeTask(
  task: AuditTask,
  files: FileContent[],
  ruleset: Ruleset,
  caller: ModelCaller,
  options: { model: string; maxTokens?: number },
): Promise<AuditTaskResult> {
  const prompt = generatePrompt(task, files, ruleset);
  const start = Date.now();

  const result = await caller(prompt.systemPrompt, prompt.userPrompt, {
    ...options,
    jsonSchema: AUDIT_FINDINGS_SCHEMA,
  });

  const durationMs = Date.now() - start;

  // Use real token counts from API when available, fall back to estimate
  const tokensUsed = result.usage
    ? result.usage.inputTokens + result.usage.outputTokens
    : Math.ceil((prompt.systemPrompt.length + prompt.userPrompt.length + result.text.length) / 4);

  return parseAuditResponse(
    result.text,
    task,
    options.model,
    tokensUsed,
    durationMs,
    result.structured,
  );
}

// ── Coverage computation ──

/**
 * Compute coverage entries from the plan and results.
 * A (component, rule) pair is "checked" if a task covering it completed successfully.
 */
function computeCoverage(
  plan: AuditPlan,
  results: AuditTaskResult[],
  failedTaskIds: Set<string>,
  skippedTaskIds: Set<string>,
): CoverageEntry[] {
  const entries: CoverageEntry[] = [];
  const completedTaskIds = new Set(results.map((r) => r.taskId));

  for (const task of plan.waves.wave1) {
    if (!task.component) continue;

    for (const ruleId of task.rules) {
      if (completedTaskIds.has(task.id) && !failedTaskIds.has(task.id)) {
        entries.push({ component: task.component, ruleId, checked: true });
      } else if (failedTaskIds.has(task.id)) {
        entries.push({
          component: task.component,
          ruleId,
          checked: false,
          reason: "agent failed",
        });
      } else if (skippedTaskIds.has(task.id)) {
        entries.push({
          component: task.component,
          ruleId,
          checked: false,
          reason: "budget exceeded",
        });
      } else {
        entries.push({
          component: task.component,
          ruleId,
          checked: false,
          reason: "task not executed",
        });
      }
    }
  }

  return entries;
}

// ── Main executor ──

/**
 * Execute an audit plan end-to-end.
 *
 * Flow: Wave 1 (component scans, parallel) → Wave 2 (cross-cutting, parallel) → Wave 3 (synthesis).
 * Wave 3 is done in-process (deduplication + coverage), not via an API call.
 */
export async function executeAuditPlan(
  plan: AuditPlan,
  files: FileContent[],
  ruleset: Ruleset,
  options: ExecutorOptions,
): Promise<ComplianceReport> {
  const {
    caller,
    model = DEFAULT_MODEL,
    maxTokens = DEFAULT_MAX_TOKENS,
    concurrency = DEFAULT_CONCURRENCY,
    onProgress,
  } = options;

  const callOptions = { model, maxTokens };
  const startedAt = new Date().toISOString();
  const allResults: AuditTaskResult[] = [];
  const failedTaskIds = new Set<string>();
  const skippedTaskIds = new Set<string>();
  let tasksFailed = 0;
  let tasksSkipped = 0;
  let cumulativeEstimatedTokens = 0;

  onProgress?.({ type: "plan-ready", plan });

  // Build file lookup for quick access
  const filesByPath = new Map(files.map((f) => [f.relativePath, f]));

  function resolveFiles(task: AuditTask): FileContent[] {
    return task.files
      .map((path) => filesByPath.get(path))
      .filter((f): f is FileContent => f !== undefined);
  }

  /**
   * Filter tasks by budget. Tasks are already sorted by priority (lowest number = highest priority).
   * Skip tasks whose cumulative estimated tokens exceed the budget.
   */
  function applyBudget(tasks: AuditTask[]): AuditTask[] {
    if (!options.budget) return tasks;

    const eligible: AuditTask[] = [];
    for (const task of tasks) {
      if (cumulativeEstimatedTokens + task.estimatedTokens > options.budget) {
        tasksSkipped++;
        skippedTaskIds.add(task.id);
        onProgress?.({ type: "task-skipped", task, reason: "budget-exceeded" });
        continue;
      }
      cumulativeEstimatedTokens += task.estimatedTokens;
      eligible.push(task);
    }
    return eligible;
  }

  // ── Wave 1: Component scans ──
  if (plan.waves.wave1.length > 0) {
    const wave1Tasks = applyBudget(plan.waves.wave1);
    onProgress?.({ type: "wave-start", wave: 1, taskCount: wave1Tasks.length });

    const wave1Results = await runWithConcurrency(
      wave1Tasks,
      (task) => {
        onProgress?.({ type: "task-start", task });
        return executeTask(task, resolveFiles(task), ruleset, caller, callOptions);
      },
      concurrency,
      {
        onResult: (task, result) => onProgress?.({ type: "task-complete", task, result }),
        onError: (task, error) => {
          tasksFailed++;
          failedTaskIds.add(task.id);
          onProgress?.({ type: "task-error", task, error });
        },
      },
    );

    allResults.push(...wave1Results);
    onProgress?.({ type: "wave-complete", wave: 1, results: wave1Results });
  }

  // ── Wave 2: Cross-cutting analysis ──
  if (plan.waves.wave2.length > 0) {
    const wave2Tasks = applyBudget(plan.waves.wave2);
    onProgress?.({ type: "wave-start", wave: 2, taskCount: wave2Tasks.length });

    const wave2Results = await runWithConcurrency(
      wave2Tasks,
      (task) => {
        onProgress?.({ type: "task-start", task });
        return executeTask(task, resolveFiles(task), ruleset, caller, callOptions);
      },
      concurrency,
      {
        onResult: (task, result) => onProgress?.({ type: "task-complete", task, result }),
        onError: (task, error) => {
          tasksFailed++;
          failedTaskIds.add(task.id);
          onProgress?.({ type: "task-error", task, error });
        },
      },
    );

    allResults.push(...wave2Results);
    onProgress?.({ type: "wave-complete", wave: 2, results: wave2Results });
  }

  // ── Wave 3: Synthesis (in-process) ──
  onProgress?.({ type: "wave-start", wave: 3, taskCount: 1 });

  const corroboratedFindings = deduplicateFindings(allResults);

  // Apply suppressions
  let activeFindings = corroboratedFindings;
  let suppressedCount = 0;

  if (options.targetPath) {
    const configRules = parseSuppressConfig(options.targetPath);
    const inlineSuppressions = parseInlineSuppressions(files);
    const { active, suppressed } = applySuppressions(
      corroboratedFindings,
      configRules,
      inlineSuppressions,
    );
    activeFindings = active;
    suppressedCount = suppressed.length;
  }

  const summary = summarizeFindings(activeFindings);
  const coverageEntries = computeCoverage(plan, allResults, failedTaskIds, skippedTaskIds);

  const totalComponents = plan.components.length;
  const checkedComponents = new Set(
    coverageEntries.filter((e) => e.checked).map((e) => e.component),
  ).size;

  const totalRules = plan.stats.totalRules;
  const checkedRules = new Set(coverageEntries.filter((e) => e.checked).map((e) => e.ruleId)).size;

  const completedAt = new Date().toISOString();
  const totalDurationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();

  const report: ComplianceReport = {
    scope: {
      ruleset: ruleset.meta.framework,
      rulesetVersion: ruleset.meta.rulesetVersion,
      components: plan.components.map((c) => c.name),
      totalFiles: plan.stats.totalFiles,
      ...(options.diff ? { diff: options.diff } : {}),
    },
    findings: activeFindings,
    summary,
    coverage: {
      entries: coverageEntries,
      componentCoverage: totalComponents > 0 ? checkedComponents / totalComponents : 0,
      ruleCoverage: totalRules > 0 ? checkedRules / totalRules : 0,
    },
    metadata: {
      startedAt,
      completedAt,
      totalDurationMs,
      tasksExecuted: allResults.length,
      tasksFailed,
      totalTokensUsed: allResults.reduce((sum, r) => sum + r.tokensUsed, 0),
      models: [...new Set(allResults.map((r) => r.model))],
      ...(tasksSkipped > 0 ? { tasksSkipped } : {}),
      ...(suppressedCount > 0 ? { suppressedCount } : {}),
    },
  };

  onProgress?.({ type: "wave-complete", wave: 3, results: [] });
  onProgress?.({ type: "complete", report });

  return report;
}
