# kart — next phases

Continuation plan for kart after phase 0 completion. Phase 0 shipped `kart_zoom` (levels 0/1/2, file + directory) and `kart_cochange` (kiste sqlite integration). Plugin packaging (skill, prompt hooks, marketplace) is done.

## What's done (phase 0)

- `kart_zoom`: 3 zoom levels, export detection via text scanning, directory zoom, per-tool ManagedRuntime
- `kart_cochange`: read-only sqlite queries against `.varp/cochange.db`, graceful degradation
- Pure/effectful split: `src/pure/` (Errors, ExportDetection, Signatures, types) vs `src/` (Lsp, Symbols, Cochange, Tools, Mcp)
- Testing: 49 tests (24 pure with coverage, 25 integration), LSP-dependent tests skippable
- Plugin: `.claude-plugin/plugin.json`, skill (`skills/zoom/`), prompt hooks (`hooks/hooks.json`), marketplace entry
- Docs: README, design.md, architecture.md

## Phase 0.1: file watcher (keep LSP in sync) ✓

**Shipped.** Recursive `fs.watch` on workspace root watches `*.ts`, `*.tsx`, `tsconfig.json`, `package.json`. On change, sends `workspace/didChangeWatchedFiles` to the LS. For already-open documents, also sends `textDocument/didChange` with refreshed content. Watcher errors (EMFILE) are silently ignored. `updateOpenDocument(uri)` exposed on `LspClient` for programmatic refresh. Watcher attached to Effect Scope finalizer.

**Decisions made**: Bun's `fs.watch` with `{recursive: true}` works on macOS. No debounce needed — events forwarded immediately. Watcher errors are non-fatal (stale state is acceptable fallback).

## Phase 1: `kart_impact` latency spike (research) ✓

**Result: live BFS is viable (Path A).** `prepareCallHierarchy` + `incomingCalls` methods added to LspClient and tested.

### Latency Data

**kart codebase (~18 files, 4 symbols):**

| Symbol | Depth 3 Total | Depth 3 Calls | Avg/call | Max fan-out |
|--------|--------------|---------------|----------|-------------|
| extractSignature | 31ms | 5 | 6ms | 3 |
| isExported | 24ms | 6 | 4ms | 3 |
| extractDocComment | 24ms | 5 | 5ms | 3 |
| symbolKindName | 21ms | 5 | 4ms | 3 |

**varp codebase (~50 files, parseManifest — highest fan-out function):**

| Depth | Calls | Total | Avg/call | Max fan-out | Visited |
|-------|-------|-------|----------|-------------|---------|
| 1 | 1 | 347ms | 347ms (cold) | 11 | 1 |
| 2 | 12 | 54ms | 5ms | 11 | 12 |
| 3 | 16 | 47ms | 3ms | 11 | 16 |

First call includes cold start (LS loading the file). Subsequent calls are 3-5ms. Depth-3 BFS with fan-out 11 completes in <500ms total.

**Decision: Path A (live BFS).** Even worst-case symbols complete depth-3 well under 2s. No pre-computed index needed. Phase 2 should implement BFS in SymbolIndex with `Effect.timeout(30_000)` for safety.

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
