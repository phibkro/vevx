/**
 * Type declarations for @varp/core/lib.
 * Hand-maintained to avoid requiring consumers to resolve core's internal path aliases.
 */

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

export function componentPaths(comp: Component): string[];

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

// ── Scheduler types ──

export type Hazard = {
  type: "RAW" | "WAR" | "WAW" | "MUTEX";
  source_task_id: string;
  target_task_id: string;
  component: string;
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
export function renderGraph(manifest: Manifest, opts?: { direction?: "TD" | "LR" }): string;
export function scanImports(manifest: Manifest, manifestDir?: string): ImportScanResult;
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
