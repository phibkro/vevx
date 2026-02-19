/**
 * Library entry point for programmatic use.
 * Re-exports types and functions for external consumers (@varp/core/lib).
 *
 * NOTE: Uses relative paths instead of #shared alias so that external consumers
 * can resolve types without core's tsconfig paths.
 */

// Types + Schemas
export {
  componentPaths,
  TouchesSchema,
  TaskDefinitionSchema,
  CodebaseGraphSchema,
} from "./shared/types.js";
export type { Manifest, Component, Stability, Touches } from "./shared/types.js";

// Ownership
export { findOwningComponent, buildComponentPaths } from "./shared/ownership.js";
export type { ComponentPathEntry } from "./shared/ownership.js";

// Dependency graph
export { invalidationCascade, validateDependencyGraph } from "./manifest/graph.js";

// Manifest (Bun-dependent via Bun.YAML)
export { parseManifest } from "./manifest/parser.js";
export { issueKey, loadSuppressions, saveSuppressions, runLint } from "./manifest/lint.js";
export type { LintSuppressions } from "./manifest/lint.js";
export { ackFreshness, checkFreshness, checkWarmStaleness } from "./manifest/freshness.js";
export { renderAsciiGraph, renderGraph, renderTagGroups } from "./manifest/render-graph.js";
export type { AsciiGraphOptions } from "./manifest/render-graph.js";
export { scanImports } from "./manifest/imports.js";
export { resolveDocs } from "./manifest/resolver.js";
export { checkEnv } from "./manifest/env-check.js";
export { scanLinks } from "./manifest/links.js";
export type { LinkScanMode } from "./manifest/links.js";
export {
  suggestComponents,
  DEFAULT_DETECTION_CONFIG,
  type DetectionConfig,
} from "./manifest/suggest-components.js";
export { suggestTouches } from "./manifest/touches.js";
export { watchFreshness } from "./manifest/watch.js";
export { findScopedTests } from "./manifest/scoped-tests.js";

// Plan (Bun-dependent via file reads)
export { parsePlanFile } from "./plan/parser.js";
export { validatePlan } from "./plan/validator.js";
export { diffPlans } from "./plan/diff.js";
export { parseLogFile } from "./plan/log-parser.js";

// Scheduler
export { detectHazards } from "./scheduler/hazards.js";
export { computeWaves } from "./scheduler/waves.js";
export { computeCriticalPath } from "./scheduler/critical-path.js";

// Enforcement
export { verifyCapabilities } from "./enforcement/capabilities.js";
export { deriveRestartStrategy } from "./enforcement/restart.js";

// Analysis
export {
  AnalysisConfigSchema,
  FreshnessConfigSchema,
  loadAnalysisConfig,
  toFilterConfig,
} from "./analysis/config.js";
export type { AnalysisConfig } from "./analysis/config.js";
export { analyzeCoChanges, computeFileFrequencies, scanCoChanges } from "./analysis/co-change.js";
export { scanCoChangesWithCache } from "./analysis/cache.js";
export { buildCodebaseGraph } from "./analysis/graph.js";
export type { BuildGraphOptions } from "./analysis/graph.js";
export {
  buildCouplingMatrix,
  findHiddenCoupling,
  componentCouplingProfile,
} from "./analysis/matrix.js";
export {
  computeComplexityTrends,
  computeComplexityTrendsFromStats,
  computeHotspots,
  countLines,
  fileNeighborhood,
  parseNumstatLog,
} from "./analysis/hotspots.js";
export type { FileNeighbor, HotspotEntry, TrendDirection, TrendInfo } from "./analysis/hotspots.js";

// Execution
export { estimateTokens, createChunks, formatChunkSummary } from "./execution/chunker.js";
export { FileContentSchema, ChunkSchema } from "./execution/chunker.js";
export type { FileContent, Chunk } from "./execution/chunker.js";
export {
  ModelCallerResultSchema,
  TaskResultSchema,
  TaskResultMetricsSchema,
} from "./execution/types.js";
export type {
  ModelCaller,
  ModelCallerResult,
  TaskResult,
  TaskResultMetrics,
} from "./execution/types.js";
export { runWithConcurrency } from "./execution/concurrency.js";
export type { ConcurrencyCallbacks } from "./execution/concurrency.js";

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
  CoChangeGraph,
  CoChangeEdge,
  FilterConfig,
  CouplingMatrix,
  CouplingEntry,
  CouplingClassification,
  ResolvedDoc,
  ResolvedDocs,
  EnvCheckResult,
  WarmStalenessResult,
  StaleComponent,
  LinkScanResult,
  BrokenLink,
  InferredDep,
  SuggestedComponent,
  SuggestComponentsResult,
  ScopedTestResult,
  CapabilityReport,
  Violation,
  RestartStrategy,
  TaskDefinition,
  CodebaseGraph,
  Wave,
  CriticalPath,
  PlanDiff,
  MetadataChange,
  ContractChange,
  TaskChange,
  TaskFieldChange,
  ExecutionLog,
  TaskLog,
  TaskMetrics,
  PostconditionCheck,
  InvariantCheck,
  WaveLog,
  ExecutionLogCost,
  WatchFreshnessResult,
  FreshnessChange,
} from "./shared/types.js";
