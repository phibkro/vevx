/**
 * Type declarations for @varp/core/bun.
 * Hand-maintained to avoid requiring consumers to resolve core's internal path aliases.
 * Extends lib.d.ts with Bun-dependent functions.
 */

// Everything from lib.d.ts
export * from "./lib";

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

// ── Bun-dependent functions ──

export function parseManifest(manifestPath: string): Manifest;
export function runLint(manifest: Manifest, manifestPath: string): Promise<LintReport>;
export function checkFreshness(manifest: Manifest): FreshnessReport;
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
