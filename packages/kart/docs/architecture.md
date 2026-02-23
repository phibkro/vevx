# kart architecture

## overview

kart is an MCP server providing progressive code disclosure, behavioral coupling, impact analysis, workspace navigation, AST-aware editing, import graph analysis, and reference-aware rename. Twenty-three tools across five categories:

- **LSP-backed** (Effect runtime): `kart_zoom`, `kart_impact`, `kart_deps`, `kart_references`, `kart_rename`, `kart_definition`, `kart_type_definition`, `kart_implementation`, `kart_code_actions`, `kart_expand_macro`, `kart_inlay_hints` — require `typescript-language-server` (TS) or `rust-analyzer` (Rust), routed by file extension
- **Cached navigation**: `kart_find` (oxc-parser for TS, tree-sitter for Rust, mtime-cached symbols) — first call scans full workspace, subsequent calls near-instant
- **Stateless navigation**: `kart_search` (ripgrep), `kart_list` (fs), `kart_cochange` (SQLite), `kart_diagnostics` (oxlint for TS, cargo clippy for Rust), `kart_imports` (oxc-parser), `kart_importers` (oxc-parser), `kart_unused_exports` (oxc-parser)
- **Stateless editing**: `kart_replace`, `kart_insert_after`, `kart_insert_before` — oxc-parser (TS) / tree-sitter (Rust) for symbol location + syntax validation, optional post-edit formatting (oxfmt/rustfmt), oxlint for diagnostics
- **Server lifecycle**: `kart_restart` — disposes all LSP runtimes (TS + Rust) + clears symbol cache

```
MCP client ──stdio──▷ Mcp.ts (McpServer + ManagedRuntime)
                        │
              ┌─────────┼──────────────────────────┐
              ▼         ▼                ▼         ▼
        cochangeRuntime  zoomRuntime  rustRuntime  stateless tools
              │              │            │      (find, search, list, edit, diagnostics, imports)
        CochangeDb    SymbolIndex   SymbolIndex          │
        (bun:sqlite)      │            │          ┌──────┼──────┐
                      LspClient    LspClient    oxc-parser  ripgrep  oxlint
                  (typescript-ls)  (rust-analyzer)  tree-sitter
```

LSP-backed tools route by file extension: `.ts`/`.tsx` → `zoomRuntime` (typescript-language-server), `.rs` → `rustRuntime` (rust-analyzer, lazy — created on first `.rs` tool call). Cochange has its own `cochangeRuntime`. Stateless tools run without Effect runtime — direct async handlers.

## module structure

Code is split into `src/pure/` (deterministic, no IO) and `src/` (effectful services):

```
src/
  pure/
    types.ts             — DocumentSymbol, LspRange, ZoomSymbol, ZoomResult, CallHierarchyItem, ImpactNode, ImpactResult, DepsNode, DepsResult, ImportEntry, FileImports, ImportGraph, ImportsResult, ImportersResult, DefinitionResult, TypeDefinitionResult, ImplementationResult, CodeActionsResult, ExpandMacroResult, InlayHint, InlayHintsResult
    Errors.ts            — 3 Data.TaggedError types
    ExportDetection.ts   — isExported() pure text scanner
    Signatures.ts        — extractSignature, extractDocComment, findBodyOpenBrace, symbolKindName
    OxcSymbols.ts        — parseSymbols() via oxc-parser — name, kind, exported, line, byte range
    RustSymbols.ts       — parseRustSymbols() via tree-sitter — same OxcSymbol shape for Rust
    AstEdit.ts           — locateSymbol, validateSyntax, spliceReplace, spliceInsertAfter, spliceInsertBefore (TS + Rust dispatch)
    Resolve.ts           — loadTsconfigPaths, resolveAlias, resolveSpecifier, bunResolve (tsconfig path resolution)
    ImportGraph.ts       — extractFileImports, buildImportGraph, transitiveImporters (oxc AST import graph)
  Lsp.ts                 — LspClient service, JsonRpcTransport, LspClientLive layer, LanguageServerConfig (TS/Rust)
  Symbols.ts             — SymbolIndex service, toZoomSymbol, zoomDirectory, impact, deps, references, rename, definition, typeDefinition, implementation, codeActions, expandMacro, inlayHints
  Cochange.ts            — CochangeDb service, SQL query, graceful degradation
  Find.ts                — findSymbols: workspace-wide symbol search via oxc-parser (TS) / tree-sitter (Rust)
  Search.ts              — searchPattern: text search via ripgrep subprocess
  List.ts                — listDirectory: recursive directory listing with glob
  Editor.ts              — editReplace, editInsertAfter, editInsertBefore: AST-aware edit pipeline with optional formatting (TS + Rust)
  Diagnostics.ts         — runDiagnostics: oxlint (TS) + cargo clippy (Rust), auto-routed by extension
  Imports.ts             — getImports, getImporters: import graph queries with barrel expansion
  Tools.ts               — 23 tool definitions (Zod schemas + Effect/async handlers)
  Mcp.ts                 — MCP server entrypoint, per-tool ManagedRuntime
  __fixtures__/          — test fixtures (exports.ts, other.ts, tsconfig.json)
```

The `pure/` boundary is the testing contract: pure modules get coverage thresholds enforced, effectful modules get integration tests without coverage gates.

## services

### LspClient (`src/Lsp.ts`)

Manages a persistent language server process over JSON-RPC/stdio. Parameterized via `LanguageServerConfig` — two built-in configs: `tsLanguageServer` (typescript-language-server) and `rustLanguageServer` (rust-analyzer).

**Lifecycle:** `Layer.scoped` + `Scope.addFinalizer`. Spawns the LS on first use, kills on scope disposal. The scope is tied to the `ManagedRuntime` — which lives for the entire MCP server process.

**JSON-RPC transport:** `JsonRpcTransport` class handles Content-Length framing with a `Uint8Array` byte buffer (not string — Content-Length counts bytes, not characters). Request/response correlation via incrementing integer IDs. Pending requests stored in a `Map<number, { resolve, reject }>`.

**Binary resolution:** `node_modules/.bin/<binary>` first, `Bun.which()` fallback. Binary name comes from `LanguageServerConfig`.

**Methods:**
- `documentSymbol(uri)` — hierarchical symbol tree for a file
- `semanticTokens(uri)` — decoded semantic tokens (delta-encoded from LSP)
- `updateOpenDocument(uri)` — re-read file from disk and send `didChange` to the LS (for programmatic refresh)
- `prepareCallHierarchy(uri, line, character)` — get call hierarchy items at a position
- `incomingCalls(item)` — callers of a call hierarchy item
- `outgoingCalls(item)` — callees of a call hierarchy item
- `references(uri, line, character, includeDeclaration?)` — all references to a symbol
- `rename(uri, line, character, newName)` — workspace edit for renaming a symbol
- `definition(uri, line, character)` — go to definition (Location | LocationLink normalization)
- `typeDefinition(uri, line, character)` — go to type definition
- `implementation(uri, line, character)` — find implementations of interface/trait
- `codeAction(uri, range)` — available code actions at a range
- `expandMacro(uri, line, character)` — expand Rust macro (rust-analyzer extension)
- `inlayHints(uri, range)` — inferred type annotations and parameter names for a range
- `shutdown()` — explicit early termination (sets flag to prevent duplicate cleanup in finalizer)

**File watching:** A recursive `fs.watch` on the workspace root monitors extensions and filenames from `LanguageServerConfig` (e.g. `*.ts`/`*.tsx`/`tsconfig.json` for TS, `*.rs`/`Cargo.toml` for Rust). On change, sends `workspace/didChangeWatchedFiles` to the LS. Watcher errors (e.g. EMFILE) are silently ignored — stale state is an acceptable fallback.

### SymbolIndex (`src/Symbols.ts`)

Depends on `LspClient`. Transforms raw LSP responses into structured zoom results. Delegates pure computation to `src/pure/`:

- **Signature extraction** via `extractSignature` from `pure/Signatures.ts`
- **Doc comment extraction** via `extractDocComment` from `pure/Signatures.ts`
- **Export detection** via `isExported` from `pure/ExportDetection.ts`

**Inlay Hints:** `inlayHints(path, range?)` returns compiler-inferred type hints and parameter names for a file or range via LSP `textDocument/inlayHint`. Defaults to the full file when range is omitted.

**Factory:** `SymbolIndexLive(config?: { rootDir?: string })` returns a `Layer<SymbolIndex, never, LspClient>`. The `rootDir` parameter (defaults to `process.cwd()`) defines the workspace boundary — all path requests are validated against it. Paths outside the boundary yield `FileNotFoundError`.

**Zoom levels:**

| level | source | content |
|-------|--------|---------|
| 0 | LSP `documentSymbol` + text scan | exported symbols only, signatures, doc comments |
| 1 | LSP `documentSymbol` | all symbols, signatures, doc comments |
| 2 | `readFileSync` | full file content, capped at 100KB |

Level-2 reads are capped at `MAX_LEVEL2_BYTES` (100KB). Files exceeding this return a structured message with the file size instead of the content.

**Directory zoom:** when path is a directory, returns level-0 for each `.ts`/`.tsx`/`.rs` file (non-recursive, test files excluded). Files with no exports are omitted.

**Impact analysis:** `impact(path, symbolName, maxDepth?)` computes the blast radius of changing a symbol. Uses `documentSymbol` to locate the target by name, `prepareCallHierarchy` to get a call hierarchy item, then BFS over `incomingCalls` up to `maxDepth` (default 3, hard cap `MAX_IMPACT_DEPTH` = 5). A `visited` set prevents cycles. Returns an `ImpactResult` tree with `totalNodes`, `highFanOut` flag (triggered when any node exceeds `HIGH_FAN_OUT_THRESHOLD` = 10 callers), and the caller tree rooted at the target symbol.

**References:** `references(path, symbolName, includeDeclaration?)` finds all usages of a symbol across the workspace via LSP `textDocument/references`. Returns `ReferencesResult` with file paths, line/character positions, and total count.

**Rename:** `rename(path, symbolName, newName)` performs reference-aware rename via LSP `textDocument/rename`. Applies the returned `WorkspaceEdit` (text edits per file, applied bottom-up to preserve offsets), validates workspace boundaries for each affected file, and notifies the LSP of changes. Returns `RenameResult` with list of modified files and total edit count.

**Definition / TypeDefinition / Implementation:** Same pattern as references — `findSymbolByName` → `selectionRange` position → LSP request → normalize `Location | LocationLink` responses (handles both `uri`/`range` and `targetUri`/`targetSelectionRange`).

**Code Actions:** `codeActions(path, symbolName)` returns available quick fixes and refactorings at a symbol's position. Read-only — returns titles and kinds without applying.

**Expand Macro:** `expandMacro(path, symbolName)` calls `rust-analyzer/expandMacro` to expand a Rust macro. Returns `{ name, expansion }` or empty expansion when the symbol isn't a macro.

### CochangeDb (`src/Cochange.ts`)

Read-only SQLite client for `.varp/cochange.db` (owned by kiste).

**Cached connections:** a module-level `Map<string, Database>` caches open connections by `dbPath`. The first `neighbors()` call for a given path opens the database; subsequent calls reuse the cached connection. Read-only mode (`{ readonly: true }`) ensures kart never writes to kiste's index.

**Graceful degradation:** if the db file doesn't exist, returns a `CochangeUnavailable` typed value (not an error). The MCP handler serializes it as structured JSON the agent can act on.

## data flow

### kart_zoom request

```
kart_zoom({ path: "src/auth.ts", level: 0, resolveTypes: true })
  │
  ├─ resolve absolute path
  ├─ check existence (FileNotFoundError if missing)
  ├─ stat: file or directory?
  │
  ├─ [directory] → iterate .ts files → level-0 per file → omit no-export files → enrich with hover
  ├─ [file, level 2] → readFileSync → return full content (no hover)
  └─ [file, level 0/1] →
       ├─ LspClient.documentSymbol(uri) → DocumentSymbol[]
       ├─ readFileSync → lines
       ├─ toZoomSymbol: extractSignature + extractDocComment + isExported (pure/)
       ├─ [level 0] → filter to exported only
       └─ [resolveTypes] → batch LspClient.hover() per symbol → zip resolvedType onto ZoomSymbol
```

### kart_impact request

```
kart_impact({ path: "src/auth.ts", symbol: "validateToken", depth: 3 })
  │
  ├─ resolve absolute path + workspace boundary check
  ├─ check existence (FileNotFoundError if missing)
  ├─ clamp depth to [1, MAX_IMPACT_DEPTH]
  ├─ LspClient.documentSymbol(uri) → find symbol by name
  │    └─ [not found] → FileNotFoundError
  ├─ LspClient.prepareCallHierarchy(uri, line, char) → CallHierarchyItem[]
  │    └─ [empty] → FileNotFoundError (call hierarchy unavailable)
  └─ BFS: buildNode(rootItem, depth=0)
       ├─ skip if visited (cycle prevention) or depth >= maxDepth
       ├─ LspClient.incomingCalls(item) → callers
       ├─ track fanOut, set highFanOut if > HIGH_FAN_OUT_THRESHOLD
       └─ recurse on each caller → ImpactNode tree
           → ImpactResult { symbol, path, depth, maxDepth, totalNodes, highFanOut, root }
```

**Latency profile:** ~350ms cold start (LSP initialization), then 3–5ms per `incomingCalls` hop. Depth-3 BFS on a 50-file codebase completes in <500ms total. No caching needed at current scale.

### kart_cochange request

```
kart_cochange({ path: "src/auth.ts" })
  │
  ├─ check if .varp/cochange.db exists
  ├─ [missing] → return CochangeUnavailable
  └─ [present] → open readonly → SQL query → ranked neighbors → close
```

### kart_find request

```
kart_find({ name: "validate", kind: "function", exported: true })
  │
  ├─ collect .ts/.tsx/.rs files recursively (excludes node_modules/dist/build/.git/.varp/target)
  ├─ check mtime cache → parse only new/changed files
  │    ├─ .ts/.tsx → oxc-parser
  │    └─ .rs → tree-sitter (lazy init on first .rs file)
  ├─ evict cache entries for deleted files
  ├─ filter by name substring, kind, exported status
  └─ return FindResult { symbols[], fileCount, cachedFiles, durationMs }
```

### kart_search request

```
kart_search({ pattern: "TODO", glob: "*.ts" })
  │
  ├─ Bun.spawn(["rg", "--json", pattern, ...flags])
  ├─ parse JSON lines → extract matches (cap 100)
  └─ return SearchResult { matches[], truncated, durationMs }
```

### kart_replace request

```
kart_replace({ file: "src/auth.ts", symbol: "validate", content: "function validate() { ... }" })
  │
  ├─ [.rs file] → initRustParser() if not ready
  ├─ readFileSync(file)
  ├─ locateSymbol(source, symbolName) via oxc-parser (TS) or tree-sitter (Rust)
  │    └─ [not found] → error
  ├─ validateSyntax(newContent) via oxc-parser (TS) or tree-sitter hasError (Rust)
  │    └─ [syntax error] → error with message
  ├─ spliceReplace(source, range, content)
  ├─ validateSyntax(fullFile) — check the whole file after splice
  │    └─ [syntax error] → error, file NOT written
  ├─ writeFileSync(file, result)
  ├─ [format: true] → formatFile(file) → oxfmt (TS) or rustfmt (Rust)
  └─ runOxlint(file) → best-effort diagnostics
      → EditResult { success, path, symbol, diagnostics[], syntaxError, formatted?, formattingError? }
```

## tool registration

Zod schemas at the MCP boundary (tool inputs). Each tool definition in `Tools.ts` is a self-contained object with `name`, `description`, `inputSchema` (Zod), `annotations`, and `handler`.

Three handler patterns:
- **Effect-based** (zoom, impact, deps, references, rename, cochange): handlers return `Effect.gen` generators, run via `ManagedRuntime.runPromise`
- **Stateless** (search, list, diagnostics, edit, imports, importers, unused_exports): handlers use `Effect.promise()` or `Effect.sync()` wrapping plain async/sync functions
- **Cached** (find): `Effect.promise()` wrapping mtime-cached async function

`Mcp.ts` registers tools individually. All responses include `structuredContent` for direct JSON access by callers. Effect errors are unwrapped via `errorMessage()` and become `{ isError: true, content: [{ text: "Error: ..." }] }`.

Tool annotations: `READ_ONLY` for navigation tools, `READ_WRITE` for edit tools (`kart_replace`, `kart_insert_after`, `kart_insert_before`, `kart_rename`).

## error model

| error | type | when |
|-------|------|------|
| `LspError` | `Data.TaggedError` | LS spawn failure, handshake timeout, malformed response |
| `LspTimeoutError` | `Data.TaggedError` | individual LSP request exceeds 30s deadline |
| `FileNotFoundError` | `Data.TaggedError` | requested path doesn't exist, symbol not found, or call hierarchy unavailable |
| `CochangeUnavailable` | plain object | `.varp/cochange.db` absent — structured return, not error |

All error types defined in `src/pure/Errors.ts`.

**Error message extraction:** Effect's `ManagedRuntime.runPromise` throws `FiberFailureImpl` which wraps the actual error under `Symbol.for("effect/Runtime/FiberFailure/Cause")`. The `errorMessage()` helper in `Mcp.ts` extracts `cause.error._tag` and `cause.error.path` to surface useful messages (e.g. `"FileNotFoundError: Symbol 'foo' not found in src/bar.ts"`) instead of the default `"An error has occurred"`.

## testing

267 tests across 19 files, split into pure (coverage-gated) and integration:

**Pure tests** (`src/pure/`, 117 tests, `test:pure` with `--coverage`, 100% function / 99% line):

| file | tests | what |
|------|-------|------|
| `pure/ExportDetection.test.ts` | 16 | isExported text scanning — TS fixture + Rust pub/pub(crate) |
| `pure/Signatures.test.ts` | 12 | extractSignature, extractDocComment edge cases |
| `pure/OxcSymbols.test.ts` | 14 | parseSymbols for all TS declaration kinds, exports, line numbers |
| `pure/RustSymbols.test.ts` | 7 | parseRustSymbols — all Rust declaration kinds, pub detection, impl naming |
| `pure/AstEdit.test.ts` | 21 | locateSymbol, validateSyntax, splice operations (TS + Rust) |
| `pure/Resolve.test.ts` | 15 | loadTsconfigPaths, resolveAlias, resolveSpecifier, extends chain, node_modules, edge cases |
| `pure/ImportGraph.test.ts` | 19 | extractFileImports, buildImportGraph, transitiveImporters, barrel expansion, local re-exports, default exports |

**Integration tests** (`src/*.test.ts`, 150 tests, `test:integration`):

| file | tests | what |
|------|-------|------|
| `Cochange.test.ts` | 3 | ranked neighbors, empty result, db missing |
| `Lsp.test.ts` | 14 | documentSymbol, hierarchical children, semanticTokens, updateOpenDocument, prepareCallHierarchy, incomingCalls, outgoingCalls, hover, definition (same-file + cross-file), typeDefinition, implementation, codeAction, shutdown |
| `ExportDetection.integration.test.ts` | 3 | LSP spike — semantic tokens don't distinguish exports |
| `Symbols.test.ts` | 27 | zoom levels, directory zoom, resolved types, resolveTypes opt-out, FileNotFoundError, signatures, workspace boundary, size cap, deps BFS, references, rename |
| `Find.test.ts` | 18 | symbol search by name/kind/export (TS + Rust), mtime cache, target/ exclusion |
| `Search.test.ts` | 7 | pattern search, glob filtering, path restriction, workspace boundary |
| `List.test.ts` | 6 | directory listing, recursive mode, glob filtering |
| `Diagnostics.test.ts` | 7 | oxlint + clippy integration, language routing, unavailable fallback, workspace boundary |
| `Editor.test.ts` | 14 | replace, insert after/before, syntax validation, symbol not found, workspace boundary, error paths (TS + Rust) |
| `Imports.test.ts` | 8 | getImports, getImporters, barrel expansion, workspace boundary |
| `Mcp.test.ts` | 35 | MCP integration via InMemoryTransport (all 22 tools) |
| `call-hierarchy-spike.test.ts` | 6 | BFS latency measurement across kart + varp symbols |

LSP-dependent tests use `describe.skipIf(!hasLsp)`. Fixture files in `src/__fixtures__/`.

## dependencies

```
effect              — service layer (Context.Tag, Layer, ManagedRuntime, Data.TaggedError)
@effect/platform    — (available, not heavily used)
@effect/platform-bun — (available, not heavily used)
@modelcontextprotocol/sdk — MCP server + InMemoryTransport for tests
oxc-parser          — fast TS/TSX parsing for find + edit tools (symbol extraction, syntax validation)
web-tree-sitter     — WASM-based tree-sitter runtime for Rust parsing
tree-sitter-wasms   — prebuilt .wasm grammars (provides tree-sitter-rust.wasm)
zod                 — tool input schemas
bun:sqlite          — read-only cochange queries
```
