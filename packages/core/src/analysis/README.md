# Analysis

Co-change analysis and coupling diagnostics. Combines git history (behavioral signal) with import analysis (structural signal) to surface hidden architectural coupling.

## Modules

| File | Purpose | Pure? |
|------|---------|-------|
| `co-change.ts` | Git log parser, commit filtering, edge computation, `file_frequencies` | Pure pipeline + effectful `scanCoChanges` wrapper |
| `cache.ts` | Incremental `.varp/` cache (strategy: full/incremental/current) | Pure strategy + effectful read/write/orchestrator |
| `matrix.ts` | Coupling diagnostic matrix, classification, hotspot detection | Pure |
| `graph.ts` | `buildCodebaseGraph()` — assembles a `CodebaseGraph` from manifest, co-change, imports, and optional coupling | Effectful (reads git history, filesystem) |
| `hotspots.ts` | `computeHotspots()` scores files by change frequency × LOC; `fileNeighborhood()` finds co-change neighbors annotated with import relationships | Pure (operates on `CoChangeGraph.file_frequencies`) |

## Key Concepts

**Graduated weighting:** Each file pair in a commit gets edge weight `1/(n-1)`. Small focused commits dominate; large commits contribute proportionally less.

**Diagnostic matrix:** Structural (imports) vs behavioral (co-change) signals classified into quadrants:

|  | High co-change | Low co-change |
|--|--|--|
| **High imports** | explicit_module | stable_interface |
| **Low imports** | hidden_coupling | unrelated |

**Incremental cache:** Stored in `.varp/co-change.json`. Cache strategy is config-aware — config changes trigger full recompute, new commits trigger incremental append, same HEAD returns cached data.

## Design Doc

[`docs/designs/002-relational-architecture-analysis.md`](../../../../docs/designs/002-relational-architecture-analysis.md) — full rationale for signal independence, graduated weighting, and the coupling matrix model.
