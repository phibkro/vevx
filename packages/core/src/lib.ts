/**
 * Library entry point for programmatic use.
 * Re-exports types and functions for external consumers (@varp/core/lib).
 *
 * NOTE: Uses relative paths instead of #shared alias so that external consumers
 * can resolve types without core's tsconfig paths.
 */

// Types
export { componentPaths } from "./shared/types.js";
export type { Manifest, Component, Stability } from "./shared/types.js";

// Ownership
export { findOwningComponent, buildComponentPaths } from "./shared/ownership.js";
export type { ComponentPathEntry } from "./shared/ownership.js";

// Dependency graph
export { invalidationCascade, validateDependencyGraph } from "./manifest/graph.js";

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
