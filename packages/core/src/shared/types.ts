import { z } from "zod";

// ── Component Manifest ──

export const StabilitySchema = z.enum(["stable", "active", "experimental"]);

export const ComponentSchema = z.object({
  path: z.union([z.string(), z.array(z.string()).min(1)]),
  deps: z.array(z.string()).optional(),
  docs: z.array(z.string()).default([]),
  tags: z.array(z.string()).optional(),
  test: z.string().optional(),
  env: z.array(z.string()).optional(),
  stability: StabilitySchema.optional(),
});

export const ManifestSchema = z.object({
  varp: z.string(),
  components: z.record(z.string(), ComponentSchema),
});

export type DocEntry = string;
export type Stability = z.infer<typeof StabilitySchema>;
export type Component = z.infer<typeof ComponentSchema>;
export type Manifest = z.infer<typeof ManifestSchema>;

/** Normalize component path (string | string[]) to string[]. */
export function componentPaths(comp: Component): string[] {
  return Array.isArray(comp.path) ? comp.path : [comp.path];
}

// ── Touches ──

export const TouchesSchema = z.object({
  reads: z.array(z.string()).optional(),
  writes: z.array(z.string()).optional(),
});

export type Touches = z.infer<typeof TouchesSchema>;

// ── Resolved Docs ──

export const ResolvedDocSchema = z.object({
  component: z.string(),
  doc: z.string(),
  path: z.string(),
});

export const ResolvedDocsSchema = z.object({
  docs: z.array(ResolvedDocSchema),
});

export type ResolvedDoc = z.infer<typeof ResolvedDocSchema>;
export type ResolvedDocs = z.infer<typeof ResolvedDocsSchema>;

// ── Freshness ──

export const DocFreshnessSchema = z.object({
  path: z.string(),
  last_modified: z.string(),
  stale: z.boolean(),
});

export const ComponentFreshnessSchema = z.object({
  docs: z.record(z.string(), DocFreshnessSchema),
  source_last_modified: z.string(),
});

export const FreshnessReportSchema = z.object({
  components: z.record(z.string(), ComponentFreshnessSchema),
});

export type DocFreshness = z.infer<typeof DocFreshnessSchema>;
export type ComponentFreshness = z.infer<typeof ComponentFreshnessSchema>;
export type FreshnessReport = z.infer<typeof FreshnessReportSchema>;

// ── Plan ──

export const ConditionSchema = z.object({
  id: z.string(),
  description: z.string(),
  verify: z.string(),
});

export const InvariantSchema = ConditionSchema.extend({
  critical: z.boolean(),
});

export const ContractSchema = z.object({
  preconditions: z.array(ConditionSchema),
  invariants: z.array(InvariantSchema),
  postconditions: z.array(ConditionSchema),
});

export const TaskSchema = z.object({
  id: z.string(),
  description: z.string(),
  action: z.string(),
  values: z.array(z.string()),
  touches: TouchesSchema,
  mutexes: z.array(z.string()).optional(),
});

export const PlanMetadataSchema = z.object({
  feature: z.string(),
  created: z.string(),
});

export const PlanSchema = z.object({
  metadata: PlanMetadataSchema,
  contract: ContractSchema,
  tasks: z.array(TaskSchema),
});

export type Condition = z.infer<typeof ConditionSchema>;
export type Invariant = z.infer<typeof InvariantSchema>;
export type Contract = z.infer<typeof ContractSchema>;
export type Task = z.infer<typeof TaskSchema>;
export type PlanMetadata = z.infer<typeof PlanMetadataSchema>;
export type Plan = z.infer<typeof PlanSchema>;

// ── Scheduler ──

export const WaveSchema = z.object({
  id: z.number(),
  tasks: z.array(TaskSchema),
});

export const HazardSchema = z.object({
  type: z.enum(["RAW", "WAR", "WAW", "MUTEX"]),
  source_task_id: z.string(),
  target_task_id: z.string(),
  component: z.string(),
});

export const CriticalPathSchema = z.object({
  task_ids: z.array(z.string()),
  length: z.number(),
});

export type Wave = z.infer<typeof WaveSchema>;
export type Hazard = z.infer<typeof HazardSchema>;
export type CriticalPath = z.infer<typeof CriticalPathSchema>;

// ── Enforcement ──

export const ViolationSchema = z.object({
  path: z.string(),
  declared_component: z.string().nullable(),
  actual_component: z.string(),
});

export const CapabilityReportSchema = z.object({
  valid: z.boolean(),
  violations: z.array(ViolationSchema),
});

export const RestartStrategySchema = z.object({
  strategy: z.enum(["isolated_retry", "cascade_restart", "escalate"]),
  reason: z.string(),
  affected_tasks: z.array(z.string()),
});

export type Violation = z.infer<typeof ViolationSchema>;
export type CapabilityReport = z.infer<typeof CapabilityReportSchema>;
export type RestartStrategy = z.infer<typeof RestartStrategySchema>;

// ── Link Scanner ──

export const BrokenLinkSchema = z.object({
  source_doc: z.string(),
  source_component: z.string(),
  link_text: z.string(),
  link_target: z.string(),
  resolved_path: z.string(),
  reason: z.string(),
});

export const InferredDepSchema = z.object({
  from: z.string(),
  to: z.string(),
  evidence: z.array(
    z.object({
      source_doc: z.string(),
      link_target: z.string(),
    }),
  ),
});

export const LinkScanResultSchema = z.object({
  inferred_deps: z.array(InferredDepSchema),
  missing_deps: z.array(InferredDepSchema),
  extra_deps: z.array(z.object({ from: z.string(), to: z.string() })),
  broken_links: z.array(BrokenLinkSchema),
  missing_docs: z.array(z.string()),
  total_links_scanned: z.number(),
  total_docs_scanned: z.number(),
});

export type BrokenLink = z.infer<typeof BrokenLinkSchema>;
export type InferredDep = z.infer<typeof InferredDepSchema>;
export type LinkScanResult = z.infer<typeof LinkScanResultSchema>;

// ── Import Scanner ──

export const ImportEvidenceSchema = z.object({
  source_file: z.string(),
  import_specifier: z.string(),
});

export const ImportDepSchema = z.object({
  from: z.string(),
  to: z.string(),
  evidence: z.array(ImportEvidenceSchema),
});

export const ImportScanResultSchema = z.object({
  import_deps: z.array(ImportDepSchema),
  missing_deps: z.array(ImportDepSchema),
  extra_deps: z.array(z.object({ from: z.string(), to: z.string() })),
  total_files_scanned: z.number(),
  total_imports_scanned: z.number(),
  components_with_source: z.array(z.string()).describe("Components that had source files to scan"),
});

export type ImportEvidence = z.infer<typeof ImportEvidenceSchema>;
export type ImportDep = z.infer<typeof ImportDepSchema>;
export type ImportScanResult = z.infer<typeof ImportScanResultSchema>;

// ── Validation ──

export const ValidationResultSchema = z.object({
  valid: z.boolean(),
  errors: z.array(z.string()),
  warnings: z.array(z.string()),
});

export type ValidationResult = z.infer<typeof ValidationResultSchema>;

// ── Plan Diff ──

export const MetadataChangeSchema = z.object({
  field: z.string(),
  old_value: z.string(),
  new_value: z.string(),
});

export const ContractChangeSchema = z.object({
  id: z.string(),
  section: z.enum(["preconditions", "invariants", "postconditions"]),
  type: z.enum(["added", "removed", "modified"]),
  old_value: z
    .object({
      description: z.string(),
      verify: z.string(),
      critical: z.boolean().optional(),
    })
    .optional(),
  new_value: z
    .object({
      description: z.string(),
      verify: z.string(),
      critical: z.boolean().optional(),
    })
    .optional(),
});

export const TaskFieldChangeSchema = z.object({
  field: z.string(),
  old_value: z.unknown(),
  new_value: z.unknown(),
});

export const TaskChangeSchema = z.object({
  id: z.string(),
  type: z.enum(["added", "removed", "modified"]),
  changes: z.array(TaskFieldChangeSchema).optional(),
});

export const PlanDiffSchema = z.object({
  metadata: z.array(MetadataChangeSchema),
  contracts: z.array(ContractChangeSchema),
  tasks: z.array(TaskChangeSchema),
});

export type MetadataChange = z.infer<typeof MetadataChangeSchema>;
export type ContractChange = z.infer<typeof ContractChangeSchema>;
export type TaskFieldChange = z.infer<typeof TaskFieldChangeSchema>;
export type TaskChange = z.infer<typeof TaskChangeSchema>;
export type PlanDiff = z.infer<typeof PlanDiffSchema>;

// ── Lint Report ──

export const LintIssueSeveritySchema = z.enum(["error", "warning"]);
export const LintIssueCategorySchema = z.enum(["imports", "links", "freshness", "stability"]);

export const LintIssueSchema = z.object({
  severity: LintIssueSeveritySchema,
  category: LintIssueCategorySchema,
  message: z.string(),
  component: z.string().optional(),
});

export const LintReportSchema = z.object({
  total_issues: z.number(),
  issues: z.array(LintIssueSchema),
});

export type LintIssueSeverity = z.infer<typeof LintIssueSeveritySchema>;
export type LintIssueCategory = z.infer<typeof LintIssueCategorySchema>;
export type LintIssue = z.infer<typeof LintIssueSchema>;
export type LintReport = z.infer<typeof LintReportSchema>;

// ── Scoped Tests ──

export const ScopedTestResultSchema = z.object({
  test_files: z.array(z.string()),
  components_covered: z.array(z.string()),
  run_command: z.string(),
  custom_commands: z.array(z.string()),
  required_env: z.array(z.string()),
});

export type ScopedTestResult = z.infer<typeof ScopedTestResultSchema>;

// ── Env Check ──

export const EnvCheckResultSchema = z.object({
  required: z.array(z.string()),
  set: z.array(z.string()),
  missing: z.array(z.string()),
});

export type EnvCheckResult = z.infer<typeof EnvCheckResultSchema>;

// ── Suggest Components ──

export const SuggestedComponentSchema = z.object({
  name: z.string(),
  path: z.array(z.string()),
  evidence: z.array(
    z.object({
      stem: z.string(),
      files: z.array(z.string()),
    }),
  ),
});

export const SuggestComponentsResultSchema = z.object({
  components: z.array(SuggestedComponentSchema),
  layer_dirs_scanned: z.array(z.string()),
});

export type SuggestedComponent = z.infer<typeof SuggestedComponentSchema>;
export type SuggestComponentsResult = z.infer<typeof SuggestComponentsResultSchema>;

// ── Execution Log ──

export const TaskMetricsSchema = z.object({
  tokens: z.number(),
  minutes: z.number(),
  tools: z.number(),
});

export const PostconditionCheckSchema = z.object({
  id: z.string(),
  result: z.enum(["pass", "fail"]),
});

export const TaskLogSchema = z.object({
  id: z.string(),
  status: z.enum(["COMPLETE", "PARTIAL", "BLOCKED", "NEEDS_REPLAN"]),
  metrics: TaskMetricsSchema,
  files_modified: z.array(z.string()),
  postconditions: z.array(PostconditionCheckSchema),
  observations: z.array(z.string()),
});

export const InvariantCheckSchema = z.object({
  wave: z.number(),
  checks: z.array(
    z.object({
      description: z.string(),
      result: z.enum(["pass", "fail"]),
    }),
  ),
});

export const WaveLogSchema = z.object({
  id: z.number(),
  status: z.enum(["complete", "incomplete"]),
});

export const ExecutionLogSchema = z.object({
  session: z.object({
    started: z.string(),
    mode: z.enum(["single-scope", "sequential", "parallel"]),
  }),
  tasks: z.array(TaskLogSchema),
  invariant_checks: z.array(InvariantCheckSchema),
  waves: z.array(WaveLogSchema),
});

export type TaskMetrics = z.infer<typeof TaskMetricsSchema>;
export type PostconditionCheck = z.infer<typeof PostconditionCheckSchema>;
export type TaskLog = z.infer<typeof TaskLogSchema>;
export type InvariantCheck = z.infer<typeof InvariantCheckSchema>;
export type WaveLog = z.infer<typeof WaveLogSchema>;
export type ExecutionLog = z.infer<typeof ExecutionLogSchema>;

// ── Watch Freshness ──

export const FreshnessChangeSchema = z.object({
  component: z.string(),
  doc: z.string(),
  became_stale: z.boolean(),
  source_modified: z.string(),
  doc_modified: z.string(),
});

export const WatchFreshnessResultSchema = z.object({
  changes: z.array(FreshnessChangeSchema),
  snapshot_time: z.string(),
  total_stale: z.number(),
});

export type FreshnessChange = z.infer<typeof FreshnessChangeSchema>;
export type WatchFreshnessResult = z.infer<typeof WatchFreshnessResultSchema>;

// ── Warm Staleness ──

export const StaleComponentSchema = z.object({
  component: z.string(),
  source_last_modified: z.string(),
});

export const WarmStalenessResultSchema = z.object({
  safe_to_resume: z.boolean(),
  stale_components: z.array(StaleComponentSchema),
  summary: z.string(),
});

export type StaleComponent = z.infer<typeof StaleComponentSchema>;
export type WarmStalenessResult = z.infer<typeof WarmStalenessResultSchema>;

// ── Execution Metrics ──

export const ExecutionMetricsSchema = z.object({
  task_id: z.string(),
  tokens_used: z.number(),
  minutes_elapsed: z.number(),
  tools_invoked: z.number(),
  files_modified: z.array(z.string()),
  exit_status: z.enum(["COMPLETE", "PARTIAL", "BLOCKED", "NEEDS_REPLAN"]),
  restart_count: z.number(),
  capability_violations: z.number(),
});

export type ExecutionMetrics = z.infer<typeof ExecutionMetricsSchema>;
