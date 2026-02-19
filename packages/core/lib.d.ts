/**
 * Type declarations for @varp/core/lib.
 * Hand-maintained to avoid requiring consumers to resolve core's internal path aliases.
 */

import type { ZodObject, ZodOptional, ZodArray, ZodString, ZodTypeAny } from "zod";

// ── Types from shared/types.ts ──

export type Stability = "stable" | "active" | "experimental";

export type Component = {
  path: string | string[];
  deps?: string[];
  docs: string[];
  tags?: string[];
  test?: string;
  env?: string[];
  stability?: Stability;
};

export type Manifest = {
  varp: string;
  components: Record<string, Component>;
};

export type Touches = {
  reads?: string[];
  writes?: string[];
};

export function componentPaths(comp: Component): string[];

export declare const TouchesSchema: ZodObject<
  {
    reads: ZodOptional<ZodArray<ZodString, "many">>;
    writes: ZodOptional<ZodArray<ZodString, "many">>;
  },
  "strip",
  ZodTypeAny,
  Touches,
  Touches
>;

// ── Ownership from shared/ownership.ts ──

export type ComponentPathEntry = { name: string; path: string };

export function buildComponentPaths(manifest: Manifest): ComponentPathEntry[];
export function findOwningComponent(
  filePath: string,
  manifest: Manifest,
  componentPaths?: ComponentPathEntry[],
): string | null;

// ── Graph from manifest/graph.ts ──

export function invalidationCascade(manifest: Manifest, changed: string[]): string[];
export function validateDependencyGraph(
  manifest: Manifest,
): { valid: true } | { valid: false; cycles: string[] };

// ── Lint types ──

export type LintIssueSeverity = "error" | "warning";
export type LintIssueCategory = "imports" | "links" | "freshness" | "stability";

export type LintIssue = {
  severity: LintIssueSeverity;
  category: LintIssueCategory;
  message: string;
  component?: string;
};

export type LintReport = {
  total_issues: number;
  issues: LintIssue[];
};

// ── Freshness types ──

export type DocFreshness = {
  path: string;
  last_modified: string;
  stale: boolean;
};

export type ComponentFreshness = {
  docs: Record<string, DocFreshness>;
  source_last_modified: string;
};

export type FreshnessReport = {
  components: Record<string, ComponentFreshness>;
};

// ── Resolved Docs types ──

export type ResolvedDoc = {
  component: string;
  doc: string;
  path: string;
};

export type ResolvedDocs = {
  docs: ResolvedDoc[];
};

// ── Env Check types ──

export type EnvCheckResult = {
  required: string[];
  set: string[];
  missing: string[];
};

// ── Warm Staleness types ──

export type StaleComponent = {
  component: string;
  source_last_modified: string;
};

export type WarmStalenessResult = {
  safe_to_resume: boolean;
  stale_components: StaleComponent[];
  summary: string;
};

// ── Link Scanner types ──

export type LinkScanMode = "deps" | "integrity" | "all";

export type BrokenLink = {
  source_doc: string;
  source_component: string;
  link_text: string;
  link_target: string;
  resolved_path: string;
  reason: string;
};

export type InferredDep = {
  from: string;
  to: string;
  evidence: Array<{ source_doc: string; link_target: string }>;
};

export type LinkScanResult = {
  inferred_deps: InferredDep[];
  missing_deps: InferredDep[];
  extra_deps: Array<{ from: string; to: string }>;
  broken_links: BrokenLink[];
  missing_docs: string[];
  total_links_scanned: number;
  total_docs_scanned: number;
};

// ── Suggest Components types ──

export type SuggestedComponent = {
  name: string;
  path: string[];
  evidence: Array<{ stem: string; files: string[] }>;
};

export type SuggestComponentsResult = {
  components: SuggestedComponent[];
  layer_dirs_scanned: string[];
};

// ── Scoped Tests types ──

export type ScopedTestResult = {
  test_files: string[];
  components_covered: string[];
  run_command: string;
  custom_commands: string[];
  required_env: string[];
};

// ── Plan types ──

export type Plan = {
  metadata: { feature: string; created: string };
  contract: {
    preconditions: Array<{ id: string; description: string; verify: string }>;
    invariants: Array<{ id: string; description: string; verify: string; critical: boolean }>;
    postconditions: Array<{ id: string; description: string; verify: string }>;
  };
  tasks: Array<{
    id: string;
    description: string;
    action: string;
    values: string[];
    touches: { reads: string[]; writes: string[] };
    mutexes?: string[];
  }>;
};

export type ValidationResult = {
  valid: boolean;
  errors: string[];
  warnings: string[];
};

// ── Plan Diff types ──

export type MetadataChange = {
  field: string;
  old_value: string;
  new_value: string;
};

export type ContractChange = {
  id: string;
  section: "preconditions" | "invariants" | "postconditions";
  type: "added" | "removed" | "modified";
  old_value?: { description: string; verify: string; critical?: boolean };
  new_value?: { description: string; verify: string; critical?: boolean };
};

export type TaskFieldChange = {
  field: string;
  old_value: unknown;
  new_value: unknown;
};

export type TaskChange = {
  id: string;
  type: "added" | "removed" | "modified";
  changes?: TaskFieldChange[];
};

export type PlanDiff = {
  metadata: MetadataChange[];
  contracts: ContractChange[];
  tasks: TaskChange[];
};

// ── Execution Log types ──

export type TaskMetrics = {
  tokens: number;
  minutes: number;
  tools: number;
  cost_usd?: number;
};

export type PostconditionCheck = {
  id: string;
  result: "pass" | "fail";
};

export type TaskLog = {
  id: string;
  status: "COMPLETE" | "PARTIAL" | "BLOCKED" | "NEEDS_REPLAN";
  metrics: TaskMetrics;
  files_modified: string[];
  postconditions: PostconditionCheck[];
  observations: string[];
};

export type InvariantCheck = {
  wave: number;
  checks: Array<{ description: string; result: "pass" | "fail" }>;
};

export type WaveLog = {
  id: number;
  status: "complete" | "incomplete";
};

export type ExecutionLogCost = {
  total_cost_usd: number;
  total_input_tokens: number;
  total_output_tokens: number;
};

export type ExecutionLog = {
  session: { started: string; mode: "single-scope" | "sequential" | "parallel" };
  cost?: ExecutionLogCost;
  tasks: TaskLog[];
  invariant_checks: InvariantCheck[];
  waves: WaveLog[];
};

// ── Watch Freshness types ──

export type FreshnessChange = {
  component: string;
  doc: string;
  became_stale: boolean;
  source_modified: string;
  doc_modified: string;
};

export type WatchFreshnessResult = {
  changes: FreshnessChange[];
  snapshot_time: string;
  total_stale: number;
};

// ── Scheduler types ──

export type Hazard = {
  type: "RAW" | "WAR" | "WAW" | "MUTEX";
  source_task_id: string;
  target_task_id: string;
  component: string;
};

export type Wave = {
  id: number;
  tasks: Plan["tasks"];
};

export type CriticalPath = {
  task_ids: string[];
  length: number;
};

// ── Enforcement types ──

export type Violation = {
  path: string;
  declared_component: string | null;
  actual_component: string;
};

export type CapabilityReport = {
  valid: boolean;
  violations: Violation[];
};

export type RestartStrategy = {
  strategy: "isolated_retry" | "cascade_restart" | "escalate";
  reason: string;
  affected_tasks: string[];
};

// ── Import types ──

export type ImportDep = {
  from: string;
  to: string;
  evidence: Array<{ source_file: string; import_specifier: string }>;
};

export type ImportScanResult = {
  import_deps: ImportDep[];
  missing_deps: ImportDep[];
  extra_deps: Array<{ from: string; to: string }>;
  total_files_scanned: number;
  total_imports_scanned: number;
  components_with_source: string[];
};

// ── Co-Change Analysis types ──

export type FilterConfig = {
  max_commit_files: number;
  skip_message_patterns: string[];
  exclude_paths: string[];
};

export type CoChangeEdge = {
  files: [string, string];
  weight: number;
  commit_count: number;
};

export type CoChangeGraph = {
  edges: CoChangeEdge[];
  total_commits_analyzed: number;
  total_commits_filtered: number;
  last_sha?: string;
};

export type CouplingClassification =
  | "explicit_module"
  | "stable_interface"
  | "hidden_coupling"
  | "unrelated";

export type CouplingEntry = {
  pair: [string, string];
  structural_weight: number;
  behavioral_weight: number;
  classification: CouplingClassification;
};

export type CouplingMatrix = {
  entries: CouplingEntry[];
  structural_threshold: number;
  behavioral_threshold: number;
};

// ── Bun-dependent functions ──

export function parseManifest(manifestPath: string): Manifest;
export function runLint(manifest: Manifest, manifestPath: string): Promise<LintReport>;
export function checkFreshness(manifest: Manifest, manifestDir?: string): FreshnessReport;
export function ackFreshness(
  manifest: Manifest,
  manifestDir: string,
  components: string[],
  doc?: string,
): { acked: string[] };
export function checkWarmStaleness(
  manifest: Manifest,
  components: string[],
  since: Date,
): WarmStalenessResult;
export function renderGraph(manifest: Manifest, opts?: { direction?: "TD" | "LR" }): string;
export function scanImports(manifest: Manifest, manifestDir?: string): ImportScanResult;
export function resolveDocs(manifest: Manifest, touches: Touches): ResolvedDocs;
export function checkEnv(
  manifest: Manifest,
  components: string[],
  env: Record<string, string | undefined>,
): EnvCheckResult;
export function scanLinks(manifest: Manifest, mode: LinkScanMode): LinkScanResult;
export function suggestComponents(
  rootDir: string,
  opts?: {
    layerDirs?: string[];
    suffixes?: string[];
    mode?: "layers" | "domains" | "auto";
  },
): SuggestComponentsResult;
export function suggestTouches(
  filePaths: string[],
  manifest: Manifest,
  importDeps: ImportDep[],
): Touches;
export function watchFreshness(
  manifest: Manifest,
  since?: string,
  manifestDir?: string,
): WatchFreshnessResult;
export function findScopedTests(
  manifest: Manifest,
  touches: { reads?: string[]; writes?: string[] },
  manifestDir: string,
  options?: { includeReadTests?: boolean; tags?: string[] },
): ScopedTestResult;
export function parsePlanFile(path: string): Plan;
export function validatePlan(
  plan: Plan,
  manifest: Manifest,
  hazards?: Hazard[],
  importDeps?: ImportDep[],
): ValidationResult;
export function detectHazards(
  tasks: Array<{ id: string; touches: { reads: string[]; writes: string[] } }>,
): Hazard[];
export function computeWaves(
  tasks: Array<{ id: string; touches: Touches; mutexes?: string[] }>,
): Wave[];
export function computeCriticalPath(
  tasks: Array<{ id: string; touches: Touches }>,
  hazards?: Hazard[],
): CriticalPath;
export function verifyCapabilities(
  manifest: Manifest,
  touches: Touches,
  diffPaths: string[],
): CapabilityReport;
export function deriveRestartStrategy(
  failedTask: { id: string; touches: Touches; mutexes?: string[] },
  allTasks: Array<{ id: string; touches: Touches; mutexes?: string[] }>,
  completedTaskIds: string[],
  dispatchedTaskIds: string[],
): RestartStrategy;
export function diffPlans(planA: Plan, planB: Plan): PlanDiff;
export function parseLogFile(path: string): ExecutionLog;

// ── Analysis functions ──

export function analyzeCoChanges(raw: string, config?: Partial<FilterConfig>): CoChangeGraph;
export function scanCoChanges(
  repoDir: string,
  config?: Partial<FilterConfig>,
  lastSha?: string,
): CoChangeGraph;
export function scanCoChangesWithCache(
  repoDir: string,
  config?: Partial<FilterConfig>,
): CoChangeGraph;
export function buildCouplingMatrix(
  coChange: CoChangeGraph,
  imports: ImportScanResult,
  manifest: Manifest,
  options?: {
    structural_threshold?: number;
    behavioral_threshold?: number;
    repo_dir?: string;
  },
): CouplingMatrix;
export function findHiddenCoupling(matrix: CouplingMatrix): CouplingEntry[];
export function componentCouplingProfile(
  matrix: CouplingMatrix,
  component: string,
): CouplingEntry[];
