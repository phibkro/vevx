# Analysis

Co-change analysis and coupling diagnostics. Combines git history (behavioral signal) with import analysis (structural signal) to surface hidden architectural coupling.

## Modules

| File | Purpose | Pure? |
|------|---------|-------|
| `co-change.ts` | Git log parsing, commit/file filtering, edge computation, file frequencies | Pure pipeline + effectful `scanCoChanges` wrapper |
| `cache.ts` | Incremental `.varp/` cache with strategy selection (full/incremental/current) | Pure strategy + effectful read/write/orchestrator |
| `matrix.ts` | Coupling diagnostic matrix, quadrant classification, hotspot detection, component profiles | Pure |
| `graph.ts` | `buildCodebaseGraph()` — assembles a `CodebaseGraph` from manifest, co-change, imports, and optional coupling | Effectful (reads git history, filesystem) |
| `hotspots.ts` | Hotspot scoring (frequency x LOC), file neighborhoods with import annotations, complexity trend tracking over git history | Pure parsing + effectful `countLines` and `computeComplexityTrends` wrappers |

Configuration schema and loading lives in `shared/config.ts` (cross-cutting concern).

## Public API

### co-change.ts

| Function | Signature | Description |
|----------|-----------|-------------|
| `parseGitLog` | `(raw: string) → Commit[]` | Parse `git log --pretty=format:"%H%n%s" --name-only` output into structured commits |
| `filterCommits` | `(commits, config) → { kept: Commit[]; filtered: number }` | Apply size ceiling and skip-message-patterns filter. Returns kept commits and filtered count. |
| `filterFiles` | `(commits, excludePatterns: string[]) → Commit[]` | Filter out excluded file paths using glob-like matching (`**`, `*` wildcards) |
| `computeFileFrequencies` | `(commits) → Record<string, number>` | Count per-file change frequency |
| `computeCoChangeEdges` | `(commits, typeMultipliers?) → CoChangeEdge[]` | Compute graduated-weight co-change edges. Optional type multipliers for conventional commits. |
| `analyzeCoChanges` | `(raw: string, config?, typeMultipliers?) → CoChangeGraph` | Full pure pipeline: parse → filter commits → filter files → compute edges + frequencies |
| `scanCoChanges` | `(repoDir, config?, lastSha?) → CoChangeGraph` | **Effectful.** Run `git log` and analyze. Optional `lastSha` for incremental. |

### cache.ts

| Function | Signature | Description |
|----------|-----------|-------------|
| `cacheStrategy` | `(cache, currentHead, config) → "full" \| "incremental" \| "current"` | Determine scan strategy based on cache state and config |
| `readCache` | `(varpDir) → CoChangeCache \| null` | Read `.varp/co-change.json` |
| `writeCache` | `(varpDir, cache) → void` | Write cache atomically |
| `mergeEdges` | `(existing, incremental: CoChangeGraph) → Record<string, { weight, count }>` | Merge incremental edges into existing edge record. Weights and counts are additive. |
| `mergeFrequencies` | `(existing, incremental) → Record<string, number>` | Sum frequency counts |
| `scanCoChangesWithCache` | `(repoDir, config?) → CoChangeGraph` | **Effectful.** Orchestrate cached scanning: read → strategy → scan → write → return. Loads `varp.config.yaml` via `loadConfig` when no explicit config provided. |

### matrix.ts

| Function | Signature | Description |
|----------|-----------|-------------|
| `buildCouplingMatrix` | `(coChange, imports, manifest, options?) → CouplingMatrix` | Build coupling matrix from co-change + import signals. Auto-calibrates thresholds via median. Options: `structural_threshold`, `behavioral_threshold`, `repo_dir`. |
| `findHiddenCoupling` | `(matrix) → CouplingEntry[]` | Extract hidden coupling entries (high co-change, no imports), sorted by behavioral weight descending |
| `componentCouplingProfile` | `(matrix, component) → CouplingEntry[]` | Get all coupling entries for a specific component |

### hotspots.ts

| Function | Signature | Description |
|----------|-----------|-------------|
| `computeHotspots` | `(fileFrequencies, lineCounts) → HotspotEntry[]` | Score files by change frequency x LOC. Sorted descending. |
| `countLines` | `(filePaths: string[], repoDir: string) → Record<string, number>` | **Effectful.** Count lines for multiple files, skipping missing ones. |
| `fileNeighborhood` | `(file, edges, imports) → FileNeighbor[]` | Find co-changing files, annotated with whether an import relationship exists |
| `parseNumstatLog` | `(raw) → Array<{ sha, files: NumstatEntry[] }>` | Parse `git log --numstat` output into structured add/delete counts per commit |
| `computeComplexityTrendsFromStats` | `(commits, filePaths, options?) → Record<string, TrendInfo>` | Pure trend computation from parsed numstat data. Options: `trendThreshold`, `minCommits`. |
| `computeComplexityTrends` | `(repoDir, filePaths, options?) → Record<string, TrendInfo>` | **Effectful.** Track LOC trend direction per file via git history. Options: `maxCommits`, `trendThreshold`, `minCommits`. |

### graph.ts

| Function | Signature | Description |
|----------|-----------|-------------|
| `buildCodebaseGraph` | `(manifestPath, options?) → CodebaseGraph` | **Effectful.** Assemble full `CodebaseGraph` from manifest, co-change (cached), imports, and optional coupling. Options: `filterConfig`, `withCoupling`. |

## Key Concepts

**Graduated weighting:** Each file pair in a commit gets edge weight `1/(n-1)`. Small focused commits dominate; large commits contribute proportionally less. When `type_multipliers` are configured and conventional commits are detected, weight becomes `multiplier x 1/(n-1)`.

**Diagnostic matrix:** Structural (imports) vs behavioral (co-change) signals classified into quadrants:

|  | High co-change | Low co-change |
|--|--|--|
| **High imports** | explicit_module | stable_interface |
| **Low imports** | hidden_coupling | unrelated |

Thresholds auto-calibrate to the median of non-zero values for each signal, or can be overridden manually.

**Incremental cache:** Stored in `.varp/co-change.json`. Cache strategy is config-aware — config changes trigger full recompute, new commits trigger incremental append, same HEAD returns cached data.

## Design Doc

[`docs/designs/002-relational-architecture-analysis.md`](../../../../docs/designs/002-relational-architecture-analysis.md) — full rationale for signal independence, graduated weighting, and the coupling matrix model.
