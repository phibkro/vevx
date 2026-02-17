# Core Internal

Implementation details for the Varp MCP server. For the public API surface, see [README.md](../README.md).

## Module Map

```
src/
  index.ts                    MCP server — tool definitions + server startup
  tool-registry.ts            ToolDef type + registerTools() helper (JSON + error wrapping)
  types.ts                    Zod schemas -> TypeScript types (single source of truth)
  ownership.ts                findOwningComponent() — longest-prefix match (shared by capabilities, links, imports)
  manifest/
    discovery.ts              Auto-discover README.md + docs/*.md for components
    imports.ts                Static import scanner — extract, resolve, cross-component dep inference
    links.ts                  Markdown link scanner — extract, resolve, integrity + dep inference
    scoped-tests.ts           Find test files scoped to a touches declaration
    touches.ts                Suggest touches declarations from file paths + import deps
    parser.ts                 Flat YAML -> Manifest (path resolution)
    resolver.ts               Touches x discovery -> doc paths with visibility
    freshness.ts              mtime comparison per component (uses discovery)
    graph.ts                  Reverse-dep BFS, Kahn's cycle detection
    lint.ts                   Aggregate health checks (imports, links, freshness)
  plan/
    parser.ts                 XML -> Plan via fast-xml-parser
    validator.ts              Plan-manifest consistency checks
    diff.ts                   Structural plan diff (metadata, contracts, tasks)
  scheduler/
    hazards.ts                O(n^2) pairwise RAW/WAR/WAW detection
    waves.ts                  Topological sort with wave grouping
    critical-path.ts          Longest RAW chain via DP
  enforcement/
    capabilities.ts           Diff paths vs declared write scope
    restart.ts                Failed task -> strategy derivation
```

## Key Design Decisions

**Zod as single source of truth.** Every type is defined as a Zod schema first, then inferred via `z.infer<>`. MCP tool input validation and internal type safety use the same schemas. No type drift.

**Flat YAML format.** The manifest uses a flat format: `varp` holds the version string, and all other top-level keys are component names. No `components:` wrapper, no `name:` field. The parser uses `Bun.YAML.parse` (built-in Zig-native YAML 1.2), extracts `varp`, then treats everything else as a component entry validated by `ComponentSchema`.

**Docs are plain strings.** Component docs are string paths, not objects. The README.md convention replaces `load_on` tags: docs with `basename === 'README.md'` are public (loaded for reads+writes), all others are private (loaded for writes only). Auto-discovery checks `{component.path}/README.md` and `{component.path}/docs/*.md` on disk and includes them if present. The `docs:` field is only for docs outside the component's path tree.

**Manifest tools accept `manifest_path` parameter.** Each tool reads and parses the manifest internally rather than receiving a pre-parsed manifest. Keeps the MCP interface simple (string path in, JSON out). Manifests are cached by (absolutePath, mtimeMs) so repeated calls skip re-parsing.

**Hazard detection is O(n^2) by design.** Plans rarely exceed 20 tasks. The pairwise comparison in `hazards.ts` checks every component across every task pair. Three hazard types are detected independently per component per pair.

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

WAR is suppressed when the reader also writes the same component — that case is already captured by WAW + RAW.

### Wave Computation (`waves.ts`)

1. Detect all hazards
2. Build dependency graph from RAW + WAW edges (target depends on source)
3. Recursive longest-path-from-roots assigns wave numbers: `wave(task) = max(wave(dep) for dep in deps) + 1`
4. Group tasks by wave number
5. Within each wave, sort critical-path tasks first

Cycle detection is implicit — the recursive `getWave` throws if it revisits a node in the current DFS path.

### Critical Path (`critical-path.ts`)

Longest chain of RAW dependencies via memoized DP. For each task, compute `longestPathTo(task) = max(longestPathTo(pred) + 1)` across all RAW predecessors. The global maximum is the critical path.

Returns task IDs in chain order plus the summed budget (tokens + minutes) along the path.

### Restart Strategy (`restart.ts`)

Decision tree based on touches overlap:

```
failed task has no writes?
  -> isolated_retry (always safe)

any active (completed/dispatched) task reads from failed task's writes?
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
              resolveDocs()   checkFreshness()   invalidationCascade()
              (Touches->Docs) (mtime compare)    (reverse BFS)

plan.xml --> parsePlanXml() --> Plan
                                  |
                    +-------------+---------------+
                    v             v               v
            validatePlan()   detectHazards()   computeWaves()
            (plan x manifest) (pairwise O(n^2)) (topo sort)
                                                    |
                                              computeCriticalPath()
                                              (longest RAW chain)

git diff --> verifyCapabilities() --> CapabilityReport
             (paths vs write scope)

failed task --> deriveRestartStrategy() --> RestartStrategy
               (touches overlap analysis)
```

## MCP Server Wiring (`index.ts`)

All 17 tools are defined as `ToolDef` objects in `index.ts` — each with name, description, input schema, and handler. Handlers return plain objects; `tool-registry.ts` provides `registerTools()` which wraps each with:
1. JSON serialization (`JSON.stringify(result, null, 2)`)
2. Error handling (catch → `{ isError: true }`)
3. MCP response formatting (`{ content: [{ type: "text", text }] }`)

Uses `McpServer.registerTool()` (the non-deprecated API). Shared schemas (`manifestPath`, `touchesSchema`, `budgetSchema`, `taskRefSchema`, `schedulableTaskSchema`) are defined once and reused across tool definitions. Scheduler and enforcement tools accept minimal task objects (`{id, touches}` or `{id, touches, budget}`) rather than full `Task` schemas — reduces tool description token overhead.

`varp_compute_waves` accepts inline task objects rather than loading from a plan file. This lets the orchestrator compute waves on modified task sets without writing intermediate files.

## Doc Discovery (`discovery.ts`)

Shared helper used by both resolver and freshness. Given a component, returns all doc paths: explicit (`docs:` field) + auto-discovered. Auto-discovers:
- `{component.path}/README.md` — public doc
- `{component.path}/docs/*.md` — private docs

Deduplicates by exact path match.

## Doc Resolution (`resolver.ts`)

Uses discovery to get all docs, then applies visibility rules:
- Docs with `basename(path) === 'README.md'` are public — loaded for both reads and writes
- All other docs are private — loaded for writes only

Results are deduplicated by path and returned as a flat array with `{ component, doc, path }` entries where `doc` is `basename(path, '.md')`.

## Freshness Detection (`freshness.ts`)

Compares doc file mtime against the latest mtime of any file in the component's source directory (recursive scan via `readdirSync({ recursive: true })`). A doc is stale when its mtime predates the source directory's latest file mtime. Missing files are reported as `"N/A"` timestamps with `stale: true`.

Uses `(entry as any).parentPath` to handle Bun/Node compatibility for `Dirent.parentPath` (added in Node 20.12).

## Testing

174 tests across 20 files, run via `bun test`. Test fixtures in `test-fixtures/` include multi-component manifests and invalid YAML for error path coverage. All modules have unit tests that exercise happy paths and error conditions.
