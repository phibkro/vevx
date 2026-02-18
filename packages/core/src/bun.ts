/**
 * Bun-specific entry point — requires Bun runtime (uses Bun.YAML).
 * Re-exports everything from lib.ts plus Bun-dependent functions.
 * Use "@varp/core/bun" to import these in Bun-based consumers (e.g. @varp/cli).
 *
 * NOTE: Uses relative paths instead of #shared alias so that external consumers
 * can resolve types without core's tsconfig paths.
 */

// Everything from lib.ts
export * from "./lib.js";

// Manifest (Bun-dependent via Bun.YAML)
export { parseManifest } from "./manifest/parser.js";
export { runLint } from "./manifest/lint.js";
export { checkFreshness } from "./manifest/freshness.js";
export { renderGraph } from "./manifest/render-graph.js";
export { scanImports } from "./manifest/imports.js";

// Plan (Bun-dependent via file reads)
export { parsePlanFile } from "./plan/parser.js";
export { validatePlan } from "./plan/validator.js";

// Scheduler
export { detectHazards } from "./scheduler/hazards.js";

// Types needed by consumers
export type {
  LintReport,
  LintIssue,
  LintIssueSeverity,
  LintIssueCategory,
  FreshnessReport,
  ComponentFreshness,
  DocFreshness,
  Plan,
  ValidationResult,
  Hazard,
  ImportDep,
  ImportScanResult,
} from "./shared/types.js";
