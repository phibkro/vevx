# kart — next phases

Continuation plan for kart after phase 0 completion. Phase 0 shipped `kart_zoom` (levels 0/1/2, file + directory) and `kart_cochange` (kiste sqlite integration). Plugin packaging (skill, prompt hooks, marketplace) is done.

## What's done (phase 0)

- `kart_zoom`: 3 zoom levels, export detection via text scanning, directory zoom, per-tool ManagedRuntime
- `kart_cochange`: read-only sqlite queries against `.varp/cochange.db`, graceful degradation
- Pure/effectful split: `src/pure/` (Errors, ExportDetection, Signatures, types) vs `src/` (Lsp, Symbols, Cochange, Tools, Mcp)
- Testing: 49 tests (24 pure with coverage, 25 integration), LSP-dependent tests skippable
- Plugin: `.claude-plugin/plugin.json`, skill (`skills/zoom/`), prompt hooks (`hooks/hooks.json`), marketplace entry
- Docs: README, design.md, architecture.md

## Phase 0.1: file watcher (keep LSP in sync)

**Problem.** The LSP has stale state after external edits. The `typescript-language-server` expects the client to send `workspace/didChangeWatchedFiles` notifications. Currently there's a TODO at `src/Lsp.ts:356`.

**Scope.** Small, contained change to `LspClient` layer acquisition.

### Tasks

1. **Register file watcher during LSP handshake** (`src/Lsp.ts`)
   - After `initialized` notification, register `workspace/didChangeWatchedFiles` capability via `client/registerCapability`
   - Watch patterns: `**/*.ts`, `**/*.tsx`, `tsconfig.json`, `package.json`

2. **Implement file watcher** (`src/Lsp.ts`)
   - Use Bun's `fs.watch` (recursive) on the workspace root
   - Filter events to watched patterns
   - Forward matching events as `workspace/didChangeWatchedFiles` notifications to the LS
   - Attach watcher to Effect `Scope` finalizer so it's cleaned up with the LSP process

3. **Test staleness recovery** (`src/Lsp.test.ts` or new `src/FileWatcher.test.ts`)
   - Write a fixture file → zoom it → modify file externally → zoom again → verify updated symbols
   - Use `describe.skipIf(!hasLsp)` since this requires a live LS

**Acceptance**: after an external file edit, subsequent `kart_zoom` calls return updated symbols without MCP server restart.

**Key decisions**:
- Bun's `fs.watch` vs `@effect/platform` `FileSystem.watch`: prefer Bun native since the rest of the process management uses `Bun.spawn`. Check if `Bun.FileSystemRouter` or `fs.watch` with `{recursive: true}` works on macOS — if not, fall back to `@effect/platform`.
- Debounce: LS handles batching, so forward events immediately. If noisy, add a 100ms debounce.

## Phase 1: `kart_impact` latency spike (research)

**Problem.** `kart_impact` computes transitive callers via BFS over LSP `callHierarchy/incomingCalls`. Unknown whether live traversal is viable — a 3-deep BFS with fan-out of 5 is ~155 round-trips.

**This is make-or-break research.** The result determines whether phase 2 is live BFS or a pre-computed call graph index.

### Tasks

1. **Verify `callHierarchy` support** (`src/Lsp.ts`)
   - Add `callHierarchy/prepareCallHierarchy` and `callHierarchy/incomingCalls` methods to `LspClient`
   - Test against the kart codebase itself (small, ~18 files) and against the varp codebase (~50 files)

2. **Measure latency** (spike script or test)
   - Pick 5 representative symbols at different depths (leaf function, mid-layer service, widely-used utility)
   - Measure: time per `incomingCalls` call, total BFS time at depth 1/2/3, fan-out distribution
   - Record results in a table: symbol, depth, fan-out, total calls, total time

3. **Document findings** (update `design.md` section 3.4)
   - If median BFS < 2s at depth 3: **live BFS viable** → phase 2 is implementation
   - If median BFS > 5s: **pre-computed index needed** → phase 2 is call graph caching with incremental updates
   - If 2-5s: **hybrid** — live BFS with timeout + partial results

**Acceptance**: latency data for 5+ symbols across 2 codebases, architectural decision documented.

**Key context**:
- `typescript-language-server` supports `textDocument/prepareCallHierarchy` and `callHierarchy/incomingCalls` (LSP 3.16+)
- The LspClient already has the JSON-RPC transport infrastructure — adding new methods is mechanical
- Effect's `Effect.timeout` is the right tool for per-call deadlines

## Phase 2: `kart_impact` implementation

Depends on phase 1 results. Two possible paths:

### Path A: live BFS (if spike shows < 2s)

1. **Add `callHierarchy` methods to LspClient** (if not already from spike)
2. **Implement BFS in SymbolIndex** (`src/Symbols.ts`)
   - `impact(symbolName, depth)` → BFS over `incomingCalls`, depth-limited
   - Visited set to handle cycles/fan-in
   - Returns `ImpactResult` tree (see design.md section 4)
3. **Add `kart_impact` tool** (`src/Tools.ts`, `src/Mcp.ts`)
   - Zod schema: `{ symbol: string, path: string, depth?: number }`
   - `path` is needed to locate the symbol via `prepareCallHierarchy`
4. **Per-call timeout** — `Effect.timeout(30_000)` on BFS, partial results on timeout
5. **Tests** — integration test against fixtures with known call chains

### Path B: pre-computed index (if spike shows > 5s)

1. **Call graph builder** (new module, likely `src/CallGraph.ts`)
   - Walk all files → `prepareCallHierarchy` for each function → build adjacency map
   - Store in SQLite (alongside or separate from cochange.db)
   - Incremental: re-index only changed files (use `didChangeWatchedFiles` events from phase 0.1)
2. **Graph query** — transitive closure via SQL recursive CTE or in-memory BFS over the adjacency map
3. **`kart_impact` tool** — queries the pre-computed graph
4. **Staleness** — call graph may lag behind edits. Include `lastIndexed` timestamp in results.

**Acceptance (either path)**: `kart_impact("parseConfig", "src/config.ts")` returns transitive callers up to depth 3 with file locations.

## Phase 3: multi-language (future)

Not immediately planned. Notes for when it becomes relevant:

- `LspClient` is language-agnostic at the JSON-RPC level. The TS-specific parts are: binary name (`typescript-language-server`), initialization options, and file patterns.
- Abstract these into a `LanguageAdapter` config: `{ binary, initOptions, filePatterns, symbolKindMap }`.
- Candidates: `rust-analyzer` (Rust), `pyright` (Python), `gopls` (Go).
- Each adapter is a separate file exporting a config object. `LspClient` takes the adapter config.

## File reference

| File | Purpose | Key locations |
|------|---------|---------------|
| `packages/kart/src/Lsp.ts` | LSP client, file watcher TODO at line 356 | `LspClient` service tag, `LspClientLive` layer, `JsonRpcTransport` class |
| `packages/kart/src/Symbols.ts` | Zoom logic, future impact BFS home | `SymbolIndex` service, `toZoomSymbol`, `zoomDirectory` |
| `packages/kart/src/pure/types.ts` | Data types | `DocumentSymbol`, `ZoomSymbol`, `ZoomResult`, `ImpactResult` (add here) |
| `packages/kart/src/pure/Errors.ts` | Error types | `LspError`, `LspTimeoutError`, `FileNotFoundError` |
| `packages/kart/src/Tools.ts` | MCP tool definitions | Add `kart_impact` tool here |
| `packages/kart/src/Mcp.ts` | Server entrypoint, per-tool runtimes | May need a third runtime for impact if it's resource-heavy |
| `packages/kart/design.md` | Design rationale, roadmap | Section 3.4 (transitive impact), section 9 (roadmap) |
| `packages/kart/architecture.md` | Service graph, data flow | Update with new services/tools |

## Running the project

```bash
cd packages/kart
bun install                        # install deps
bun run build                      # build MCP server → dist/Mcp.js
bun run test                       # all 49 tests (pure + integration)
bun run test:pure                  # 24 pure tests with coverage
bun run test:integration           # 25 integration tests (LSP skipped if unavailable)
bun run check                      # format + lint + build
```

MCP server: `bun packages/kart/dist/Mcp.js` (stdio transport, registered in `.mcp.json`).

## Conventions

- **Functional core, imperative shell**: pure computation in `src/pure/`, effectful services in `src/`. New pure functions go in existing pure modules or new files under `src/pure/`.
- **Effect TS**: `Context.Tag` for services, `Layer.scoped` for lifecycle, `Data.TaggedError` for errors, `ManagedRuntime` for tool isolation.
- **Zod at MCP boundary, Effect internally**: tool input schemas use Zod, everything else uses Effect types.
- **ESM only, `.js` extensions** in import specifiers.
- **Tests**: pure tests get `--coverage`, integration tests use `describe.skipIf(!hasLsp)`.
