# Shared

Shared types, utilities, and test helpers used across all core domain components.

## Files

| File              | Purpose                                                              |
| ----------------- | -------------------------------------------------------------------- |
| `types.ts`        | All Zod schemas and inferred types, grouped by domain                |
| `ownership.ts`    | Component path resolution and tag-based lookup                       |
| `config.ts`       | Project config (`.varp/config.json`) — cochange, hotspots, freshness |
| `test-helpers.ts` | Factories for `Task`, `TaskDefinition`, and `Plan` used in tests     |

## types.ts — Domain Schemas

Each section defines a Zod schema as source of truth and infers a TypeScript type via `z.infer<>`.

| Domain             | Key Schemas                                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Component Manifest | `ManifestSchema`, `ComponentSchema`, `StabilitySchema`                                                                   |
| Touches            | `TouchesSchema` (reads/writes arrays)                                                                                    |
| Resolved Docs      | `ResolvedDocSchema`, `ResolvedDocsSchema`                                                                                |
| Freshness          | `DocFreshnessSchema`, `ComponentFreshnessSchema`, `FreshnessReportSchema`, `AckFreshnessResultSchema`                    |
| Plan               | `PlanSchema`, `TaskSchema`, `ContractSchema`, `ConditionSchema`, `InvariantSchema`, `PlanMetadataSchema`                 |
| Scheduler          | `TaskDefinitionSchema` (id + touches + mutexes, no execution fields), `WaveSchema`, `HazardSchema`, `CriticalPathSchema` |
| Enforcement        | `CapabilityReportSchema`, `ViolationSchema`, `RestartStrategySchema`                                                     |
| Link Scanner       | `LinkScanResultSchema`, `BrokenLinkSchema`, `InferredDepSchema`                                                          |
| Import Scanner     | `ImportScanResultSchema`, `ImportDepSchema`, `ImportEvidenceSchema`                                                      |
| Co-Change Analysis | `CoChangeGraphSchema`, `CoChangeEdgeSchema`, `FilterConfigSchema`                                                        |
| Coupling           | `CouplingMatrixSchema`, `CouplingEntrySchema`, `CouplingClassificationSchema`                                            |
| Codebase Graph     | `CodebaseGraphSchema` (manifest + coChange + imports + optional coupling)                                                |
| Validation         | `ValidationResultSchema`                                                                                                 |
| Plan Diff          | `PlanDiffSchema`, `TaskChangeSchema`, `ContractChangeSchema`, `MetadataChangeSchema`                                     |
| Lint               | `LintReportSchema`, `LintIssueSchema`                                                                                    |
| Scoped Tests       | `ScopedTestResultSchema`                                                                                                 |
| Env Check          | `EnvCheckResultSchema`                                                                                                   |
| Suggest Components | `SuggestComponentsResultSchema`, `SuggestedComponentSchema`                                                              |
| Execution Log      | `ExecutionLogSchema`, `TaskLogSchema`, `WaveLogSchema`, `ExecutionLogCostSchema`                                         |
| Execution Metrics  | `ExecutionMetricsSchema`                                                                                                 |
| Watch Freshness    | `WatchFreshnessResultSchema`, `FreshnessChangeSchema`                                                                    |
| Warm Staleness     | `WarmStalenessResultSchema`, `StaleComponentSchema`                                                                      |

Utility: `componentPaths(comp)` normalizes `Component.path` (string or string[]) to `string[]`.

## ownership.ts

| Export                                            | Purpose                                                                     |
| ------------------------------------------------- | --------------------------------------------------------------------------- |
| `buildComponentPaths(manifest)`                   | Builds a sorted path list for batch ownership lookups (longest path first)  |
| `findOwningComponent(filePath, manifest, paths?)` | Longest-prefix match — returns owning component name or `null`              |
| `resolveComponentRefs(manifest, refs)`            | Resolves component names or tags to component names; throws on unknown refs |
| `ComponentPathEntry`                              | Type: `{ name: string; path: string }`                                      |

## config.ts

| Export                   | Purpose                                                                           |
| ------------------------ | --------------------------------------------------------------------------------- |
| `VarpConfigSchema`       | Root config schema — sections: `cochange`, `hotspots`, `freshness`                |
| `loadConfig(repoDir)`    | Loads `.varp/config.json` with sparse defaults (returns full defaults if missing) |
| `toFilterConfig(config)` | Bridges `VarpConfig` cochange section to `FilterConfig` shape                     |
| `CoChangeConfigSchema`   | Cochange tuning: commit size ceiling, message/file excludes, type multipliers     |
| `HotspotsConfigSchema`   | Hotspot tuning: max commits, trend threshold, trend min commits                   |
| `FreshnessConfigSchema`  | Freshness tuning: staleness threshold in ms                                       |

Deprecated aliases (`AnalysisConfigSchema`, `AnalysisConfig`, `loadAnalysisConfig`) forward to the `Varp`-prefixed versions.

## test-helpers.ts

| Export                                       | Purpose                                                            |
| -------------------------------------------- | ------------------------------------------------------------------ |
| `makeTask(id, writes?, reads?, mutexes?)`    | Factory for `Task` (full plan shape with defaults)                 |
| `makeTaskDef(id, writes?, reads?, mutexes?)` | Factory for `TaskDefinition` (scheduler-only, no execution fields) |
| `makePlan(tasks, contract?)`                 | Factory for `Plan` with default metadata and contract              |

## Type Convention

All types are Zod-schema-first. The schema is the source of truth; TypeScript types are inferred via `z.infer<>`.

```ts
import { ManifestSchema, type Manifest } from "#shared/types.js";
```

## Import Alias

Other core components import via `#shared/*` (configured in `tsconfig.json` paths):

```ts
import { type Manifest } from "#shared/types.js";
import { findOwningComponent } from "#shared/ownership.js";
```

External consumers (e.g. `@varp/audit`, `@varp/cli`) import via the `@varp/core/lib` entry point, which re-exports shared types and functions using relative paths (avoiding the `#shared` alias). Types come from a hand-maintained `lib.d.ts` at the package root.
