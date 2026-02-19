# Core Internal

Implementation details for the Varp MCP server. For the public API surface, see [README.md](../README.md).

## Module Map

Components: `shared` (types, ownership), `server` (MCP wiring), `manifest/`, `plan/`, `scheduler/`, `enforcement/`, `analysis/` (domain tools), `skills/`, `hooks/`. Domain components depend on `shared` via `#shared/*` import alias. `server` depends on all domain components (hub pattern). Skills and hooks depend on manifest.

```
src/
  index.ts                    MCP server — tool definitions + server startup (server)
  lib.ts                      Library entry point — all types + functions (@varp/core/lib)
  tool-registry.ts            ToolDef type + registerTools() helper (JSON + error wrapping) (server)
  shared/
    types.ts                  Zod schemas -> TypeScript types (single source of truth)
    ownership.ts              findOwningComponent() — longest-prefix match
  manifest/
    discovery.ts              Auto-discover README.md + docs/*.md for components
    imports.ts                Static import scanner — extract, resolve, cross-component dep inference (tsconfig path alias aware)
    links.ts                  Markdown link scanner — extract, resolve, integrity + dep inference
    scoped-tests.ts           Find test files scoped to a touches declaration
    suggest-components.ts     Detect components via workspace, container, indicator, layer, and domain strategies
    render-graph.ts           Render dependency graph (Mermaid + ASCII with tag/stability display)
    watch.ts                  Freshness polling — filter changes since baseline timestamp
    touches.ts                Suggest touches declarations from file paths + import deps
    parser.ts                 Flat YAML -> Manifest (path resolution)
    resolver.ts               Touches x discovery -> doc paths with visibility
    freshness.ts              mtime comparison per component + warm agent staleness check (uses discovery)
    graph.ts                  Reverse-dep BFS, Kahn's cycle detection
    env-check.ts              Check required env vars for components (set vs missing)
    lint.ts                   Aggregate health checks (imports, links, freshness, stability)
  plan/
    parser.ts                 XML -> Plan via fast-xml-parser
    validator.ts              Plan-manifest consistency checks
    diff.ts                   Structural plan diff (metadata, contracts, tasks)
    log-parser.ts             Execution log.xml parser (task metrics incl. cost_usd, plan-level cost, postconditions, waves)
  scheduler/
    hazards.ts                O(n^2) pairwise RAW/WAR/WAW/MUTEX detection
    waves.ts                  Topological sort with wave grouping
    critical-path.ts          Longest RAW chain via DP
  enforcement/
    capabilities.ts           Diff paths vs declared write scope
    restart.ts                Failed task -> strategy derivation
  analysis/
    co-change.ts              Git log parser -> co-change edge graph (1/(n-1) weighting)
    cache.ts                  Incremental .varp/ cache (strategy: full/incremental/current)
    matrix.ts                 Coupling diagnostic matrix (structural vs behavioral signals)
```

## Key Design Decisions

**Zod as single source of truth.** Every type is defined as a Zod schema first, then inferred via `z.infer<>`. MCP tool input validation and internal type safety use the same schemas. No type drift.

**Flat YAML format.** The manifest uses a flat format: `varp` holds the version string, and all other top-level keys are component names. No `components:` wrapper, no `name:` field. The parser uses `Bun.YAML.parse` (built-in Zig-native YAML 1.2), extracts `varp`, then treats everything else as a component entry validated by `ComponentSchema`.

**Docs are plain strings.** Component docs are string paths, not objects. The README.md convention replaces `load_on` tags: docs with `basename === 'README.md'` are public (loaded for reads+writes), all others are private (loaded for writes only). Auto-discovery checks `{root}/README.md` and `{root}/docs/*.md` on disk for each discovery root (component path + src-collapsed parent/child). The `docs:` field is only for docs outside the component's path tree.

**Multi-path components.** A component's `path` can be a single string or an array of strings. This supports layer-organized codebases where a domain concept (e.g. "auth") spans multiple directories (controllers, services, repositories). The `componentPaths()` helper normalizes both forms to `string[]`. All internal code uses this helper — ownership, doc discovery, import scanning, test discovery, and freshness all iterate over all paths.

**Manifest tools accept `manifest_path` parameter.** Each tool reads and parses the manifest internally rather than receiving a pre-parsed manifest. Keeps the MCP interface simple (string path in, JSON out). Manifests are cached by (absolutePath, mtimeMs) so repeated calls skip re-parsing.

**Hazard detection is O(n^2) by design.** Plans rarely exceed 20 tasks. The pairwise comparison in `hazards.ts` checks every component across every task pair. Three data hazard types (RAW/WAR/WAW) are detected independently per component per pair. MUTEX hazards are detected by comparing mutex name sets between task pairs.

**Wave computation depends on hazards and critical path.** `waves.ts` imports both `detectHazards` and `computeCriticalPath`. Hazards define the dependency graph; critical path determines sort order within waves. Hazards are computed once in `computeWaves` and passed through to `computeCriticalPath` to avoid redundant O(n^2) detection.

**Plan XML uses `fast-xml-parser` with attribute extraction.** Attributes like `writes="auth" reads="api"` and `tokens="30000" minutes="10"` are parsed via the `@_` prefix convention. The `isArray` option forces `condition`, `invariant`, and `task` elements to always be arrays even when singular.

**Capability verification sorts by path specificity.** Component paths are sorted by descending length so that overlapping paths (e.g., `/src` and `/src/auth`) match the more specific component first.

## Algorithms

### Invalidation Cascade (`graph.ts`)

Reverse-dependency BFS. Builds a reverse adjacency map (component -> components that depend on it via `deps`), then walks breadth-first from changed components. Returns all transitively affected components including the initial set.

Used by the orchestrator after task completion to determine which pending tasks need context refresh.

### Cycle Detection (`graph.ts`)

Kahn's algorithm (topological sort). Initializes in-degree counts from `deps`, processes zero-in-degree nodes iteratively. If sorted count < total components, the unsorted remainder forms cycles.

Returns `{ valid: true }` or `{ valid: false, cycles: string[] }`.

### Hazard Detection (`hazards.ts`)

For each task pair (i, j) and each component in their combined touch sets:

| Condition | Hazard | Meaning |
|-----------|--------|---------|
| i writes, j reads | RAW | True dependency (j needs i's output) |
| j writes, i reads | RAW | (reverse direction) |
| i writes, j writes | WAW | Output conflict (scheduling constraint) |
| i reads, j writes, i doesn't write | WAR | Anti-dependency |
| j reads, i writes, j doesn't write | WAR | (reverse direction) |
| i mutex ∩ j mutex ≠ ∅ | MUTEX | Mutual exclusion (scheduling constraint) |

WAR is suppressed when the reader also writes the same component — that case is already captured by WAW + RAW. MUTEX hazards are independent of touches — they check mutex name overlap between task pairs.

### Wave Computation (`waves.ts`)

1. Detect all hazards
2. Build dependency graph from RAW + WAW + MUTEX edges (target depends on source)
3. Recursive longest-path-from-roots assigns wave numbers: `wave(task) = max(wave(dep) for dep in deps) + 1`
4. Group tasks by wave number
5. Within each wave, sort critical-path tasks first

Cycle detection is implicit — the recursive `getWave` throws if it revisits a node in the current DFS path.

### Critical Path (`critical-path.ts`)

Longest chain of RAW dependencies via memoized DP. For each task, compute `longestPathTo(task) = max(longestPathTo(pred) + 1)` across all RAW predecessors. The global maximum is the critical path.

Returns task IDs in chain order plus the chain length.

### Co-Change Analysis (`analysis/co-change.ts`)

Pure pipeline: `git log` output → parse → filter commits → filter files → compute edges. Each file pair in a commit gets edge weight `1/(n-1)` where n is the number of files. This graduated weighting means small focused commits dominate the signal; large commits contribute proportionally less.

Noise filtering: hard ceiling on commit size (default 50 files) catches bulk operations regardless of commit message quality. Secondary filter matches commit message patterns (chore, format, lint, merge). File path exclude patterns remove lockfiles and generated code.

The `scanCoChanges` function is the effectful wrapper — calls `Bun.spawnSync` to run `git log --pretty=format:%H%n%s --name-only --diff-filter=ACMRD`. Accepts optional `lastSha` for incremental scanning (`lastSha..HEAD`).

### Incremental Cache (`analysis/cache.ts`)

Cache stored in `.varp/co-change.json`. Strategy decision:
- **current**: same HEAD + same config → return cached graph (no work)
- **incremental**: new commits, same config → scan only new commits, merge additive weights
- **full**: cache missing, invalid, or config changed → full rescan

Config comparison is field-by-field (max_commit_files, skip_message_patterns, exclude_paths). Edge storage is a Record<string, {weight, count}> keyed by `"fileA\0fileB"`.

### Coupling Matrix (`analysis/matrix.ts`)

Combines two independent signal layers:
1. **Behavioral**: co-change edges → component pairs via `findOwningComponent()`, aggregated weights
2. **Structural**: import deps → component pairs, weighted by evidence count (number of import statements)

Thresholds auto-calibrate to median of non-zero values. Classification is a 2x2 matrix (high/low structural × high/low behavioral). `findHiddenCoupling()` extracts the high-behavioral, low-structural quadrant — the highest-value findings.

Design doc: [`docs/coupling-measurement-design.md`](../../../docs/coupling-measurement-design.md)

### Restart Strategy (`restart.ts`)

Decision tree based on touches and mutex overlap:

```
failed task has no writes and no mutexes?
  -> isolated_retry (always safe)

any active (completed/dispatched) task reads from failed task's writes or shares a mutex?
  no -> isolated_retry
  yes, and any of those tasks are completed?
    -> escalate (completed tasks consumed bad output)
  yes, but all are only dispatched?
    -> cascade_restart (cancel and restart affected wave)
```

### Capability Verification (`capabilities.ts`)

For each modified file path:
1. Resolve to absolute path
2. Find the component whose path is a prefix (`path.relative` doesn't start with `..`), preferring the longest (most specific) match
3. If component found but not in declared write set -> violation
4. If no component matches and write set is non-empty -> violation

## Data Flow

```
varp.yaml --> parseManifest() --> Manifest
                                    |
                    +---------------+----------------+
                    v               v                v
              resolveDocs()   checkFreshness()   invalidationCascade()   checkWarmStaleness()
              (Touches->Docs) (mtime compare)    (reverse BFS)           (agent resume check)

plan.xml --> parsePlanXml() --> Plan
                                  |
                    +-------------+---------------+
                    v             v               v
            validatePlan()   detectHazards()   computeWaves()
            (plan x manifest) (pairwise O(n^2)) (topo sort)
                                                    |
                                              computeCriticalPath()
                                              (longest RAW chain)

git log --> scanCoChangesWithCache() --> CoChangeGraph
             (cached, incremental)          |
                                   buildCouplingMatrix()
                                   (+ ImportScanResult)  --> CouplingMatrix
                                                              |
                                                    findHiddenCoupling()

The analysis outputs compose into a `CodebaseGraph` (`{manifest, coChange, imports, coupling?}`) — the interface contract between the analysis layer and its consumers (audit, CLI, MCP queries).

git diff --> verifyCapabilities() --> CapabilityReport
             (paths vs write scope)

failed task --> deriveRestartStrategy() --> RestartStrategy
               (touches overlap analysis)
```

## MCP Server Wiring (`index.ts`)

Tools are defined as `ToolDef` objects in `index.ts` — each with name, description, input schema, and handler. Handlers return plain objects; `tool-registry.ts` provides `registerTools()` which wraps each with:
1. JSON serialization (`JSON.stringify(result, null, 2)`)
2. Error handling (catch → `{ isError: true }`)
3. MCP response formatting (`{ content: [{ type: "text", text }] }`)

Uses `McpServer.registerTool()` (the non-deprecated API). Shared schemas (`manifestPath`, `touchesSchema`, `mutexesSchema`, `taskRefSchema`, `schedulableTaskSchema`) are defined once and reused across tool definitions. Scheduler and enforcement tools accept `TaskDefinition` objects (`{id, touches, mutexes?}`) rather than full `Task` schemas — reduces tool description token overhead.

`varp_compute_waves` accepts inline task objects rather than loading from a plan file. This lets the orchestrator compute waves on modified task sets without writing intermediate files.

## Doc Discovery (`discovery.ts`)

Shared helper used by both resolver and freshness. Given a component, returns all doc paths: explicit (`docs:` field) + auto-discovered. For each component path, builds a set of discovery roots and scans each for docs:
- `{root}/README.md` — public doc
- `{root}/docs/*.md` — private docs

**Src-collapse:** The `src/` directory is transparent. When a component path ends in `src/`, the parent directory is also a discovery root. When a component path has a `src/` child directory, that child is also a discovery root. This means docs can live at the package root (e.g., `packages/core/README.md`) regardless of whether the component path points to `src/` or the parent.

Deduplicates by exact path match. Multi-path components discover docs from each path.

## Doc Resolution (`resolver.ts`)

Uses discovery to get all docs, then applies visibility rules:
- Docs with `basename(path) === 'README.md'` are public — loaded for both reads and writes
- All other docs are private — loaded for writes only

Results are deduplicated by path and returned as a flat array with `{ component, doc, path }` entries where `doc` is `basename(path, '.md')`.

## Freshness Detection (`freshness.ts`)

Compares doc file mtime against the latest mtime of any non-doc file in the component's source directory (recursive scan via `readdirSync({ recursive: true })`). Two categories of files are excluded from the source mtime scan: doc files (discovered via `discoverDocs()`) to prevent a race where editing a doc inflates `source_last_modified`, and test files (`*.test.ts`, `*.spec.ts`, etc. via `TEST_FILE_RE`) because test changes don't affect the interfaces that docs describe. A doc is stale when its mtime is more than 5 seconds behind the source mtime — this threshold eliminates false positives from batch edits where source and docs are updated within seconds of each other. Missing files are reported as `"N/A"` timestamps with `stale: true`.

Uses `(entry as any).parentPath` to handle Bun/Node compatibility for `Dirent.parentPath` (added in Node 20.12).

`checkWarmStaleness()` reuses the same `getLatestMtime()` helper (now exported) and `discoverDocs()` exclusion set. For each requested component, it compares the source mtime against a baseline timestamp. Components modified after the baseline are stale. Returns `{ safe_to_resume, stale_components, summary }` — the orchestrator calls this before resuming a warm agent.

## Testing

Run via `bun test`. Test fixtures in `test-fixtures/` include multi-component manifests and invalid YAML for error path coverage. All modules have unit tests that exercise happy paths and error conditions.
