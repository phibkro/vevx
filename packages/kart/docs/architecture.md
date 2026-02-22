# kart architecture

## overview

kart is an MCP server providing progressive code disclosure, behavioral coupling, and impact analysis. Three tools: `kart_zoom` (zoom levels on file/directory structure), `kart_cochange` (co-change neighbors from git history), and `kart_impact` (blast radius of changing a symbol via LSP call hierarchy).

```
MCP client ──stdio──▷ Mcp.ts (McpServer + ManagedRuntime)
                        │
              ┌─────────┴──────────┐
              ▼                    ▼
        cochangeRuntime       zoomRuntime
              │                    │
        CochangeDb           SymbolIndex ─── pure/*
        (bun:sqlite)              │
                              LspClient
                        (typescript-language-server)
```

Each tool has its own `ManagedRuntime` — LSP failure doesn't block cochange queries.

## module structure

Code is split into `src/pure/` (deterministic, no IO) and `src/` (effectful services):

```
src/
  pure/
    types.ts             — DocumentSymbol, LspRange, ZoomSymbol, ZoomResult, CallHierarchyItem, ImpactNode, ImpactResult
    Errors.ts            — 3 Data.TaggedError types
    ExportDetection.ts   — isExported() pure text scanner
    Signatures.ts        — extractSignature, extractDocComment, findBodyOpenBrace, symbolKindName
  Lsp.ts                 — LspClient service, JsonRpcTransport, LspClientLive layer
  Symbols.ts             — SymbolIndex service, toZoomSymbol, zoomDirectory, impact (BFS over call hierarchy)
  Cochange.ts            — CochangeDb service, SQL query, graceful degradation
  Tools.ts               — kart_zoom + kart_cochange + kart_impact tool definitions
  Mcp.ts                 — MCP server entrypoint, per-tool ManagedRuntime
  __fixtures__/          — test fixtures (exports.ts, other.ts, tsconfig.json)
```

The `pure/` boundary is the testing contract: pure modules get coverage thresholds enforced, effectful modules get integration tests without coverage gates.

## services

### LspClient (`src/Lsp.ts`)

Manages a persistent `typescript-language-server` process over JSON-RPC/stdio.

**Lifecycle:** `Layer.scoped` + `Scope.addFinalizer`. Spawns the LS on first use, kills on scope disposal. The scope is tied to the `ManagedRuntime` — which lives for the entire MCP server process.

**JSON-RPC transport:** `JsonRpcTransport` class handles Content-Length framing with a `Uint8Array` byte buffer (not string — Content-Length counts bytes, not characters). Request/response correlation via incrementing integer IDs. Pending requests stored in a `Map<number, { resolve, reject }>`.

**Binary resolution:** `node_modules/.bin/typescript-language-server` first, `Bun.which()` fallback.

**Methods:**
- `documentSymbol(uri)` — hierarchical symbol tree for a file
- `semanticTokens(uri)` — decoded semantic tokens (delta-encoded from LSP)
- `updateOpenDocument(uri)` — re-read file from disk and send `didChange` to the LS (for programmatic refresh)
- `prepareCallHierarchy(uri, line, character)` — get call hierarchy items at a position
- `incomingCalls(item)` — callers of a call hierarchy item
- `outgoingCalls(item)` — callees of a call hierarchy item
- `shutdown()` — explicit early termination (sets flag to prevent duplicate cleanup in finalizer)

**File watching:** A recursive `fs.watch` on the workspace root monitors `*.ts`, `*.tsx`, `tsconfig.json`, and `package.json`. On change, the watcher sends `workspace/didChangeWatchedFiles` notifications to the LS. For already-open documents, it also sends `textDocument/didChange` with refreshed content. The watcher is attached to the Effect `Scope` finalizer and cleaned up with the LSP process. Watcher errors (e.g. EMFILE) are silently ignored — stale state is an acceptable fallback.

### SymbolIndex (`src/Symbols.ts`)

Depends on `LspClient`. Transforms raw LSP responses into structured zoom results. Delegates pure computation to `src/pure/`:

- **Signature extraction** via `extractSignature` from `pure/Signatures.ts`
- **Doc comment extraction** via `extractDocComment` from `pure/Signatures.ts`
- **Export detection** via `isExported` from `pure/ExportDetection.ts`

**Factory:** `SymbolIndexLive(config?: { rootDir?: string })` returns a `Layer<SymbolIndex, never, LspClient>`. The `rootDir` parameter (defaults to `process.cwd()`) defines the workspace boundary — all path requests are validated against it. Paths outside the boundary yield `FileNotFoundError`.

**Zoom levels:**

| level | source | content |
|-------|--------|---------|
| 0 | LSP `documentSymbol` + text scan | exported symbols only, signatures, doc comments |
| 1 | LSP `documentSymbol` | all symbols, signatures, doc comments |
| 2 | `readFileSync` | full file content, capped at 100KB |

Level-2 reads are capped at `MAX_LEVEL2_BYTES` (100KB). Files exceeding this return a structured message with the file size instead of the content.

**Directory zoom:** when path is a directory, returns level-0 for each `.ts`/`.tsx` file (non-recursive, test files excluded). Files with no exports are omitted.

**Impact analysis:** `impact(path, symbolName, maxDepth?)` computes the blast radius of changing a symbol. Uses `documentSymbol` to locate the target by name, `prepareCallHierarchy` to get a call hierarchy item, then BFS over `incomingCalls` up to `maxDepth` (default 3, hard cap `MAX_IMPACT_DEPTH` = 5). A `visited` set prevents cycles. Returns an `ImpactResult` tree with `totalNodes`, `highFanOut` flag (triggered when any node exceeds `HIGH_FAN_OUT_THRESHOLD` = 10 callers), and the caller tree rooted at the target symbol.

### CochangeDb (`src/Cochange.ts`)

Read-only SQLite client for `.varp/cochange.db` (owned by kiste).

**Cached connections:** a module-level `Map<string, Database>` caches open connections by `dbPath`. The first `neighbors()` call for a given path opens the database; subsequent calls reuse the cached connection. Read-only mode (`{ readonly: true }`) ensures kart never writes to kiste's index.

**Graceful degradation:** if the db file doesn't exist, returns a `CochangeUnavailable` typed value (not an error). The MCP handler serializes it as structured JSON the agent can act on.

## data flow

### kart_zoom request

```
kart_zoom({ path: "src/auth.ts", level: 0 })
  │
  ├─ resolve absolute path
  ├─ check existence (FileNotFoundError if missing)
  ├─ stat: file or directory?
  │
  ├─ [directory] → iterate .ts files → level-0 per file → omit no-export files
  ├─ [file, level 2] → readFileSync → return full content
  └─ [file, level 0/1] →
       ├─ LspClient.documentSymbol(uri) → DocumentSymbol[]
       ├─ readFileSync → lines
       ├─ toZoomSymbol: extractSignature + extractDocComment + isExported (pure/)
       └─ [level 0] → filter to exported only
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

## tool registration

Zod schemas at the MCP boundary (tool inputs). Effect `Context.Tag` + `Layer` internally. Each tool definition in `Tools.ts` is a self-contained object with `name`, `description`, `inputSchema` (Zod), `annotations`, and `handler` (Effect generator).

`Mcp.ts` registers tools individually with typed handlers. All responses include `structuredContent` for direct JSON access by callers. Effect errors are unwrapped via `errorMessage()` and become `{ isError: true, content: [{ text: "Error: ..." }] }`.

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

72 tests across 8 files, split into pure (coverage-gated) and integration:

**Pure tests** (`src/pure/`, 24 tests, `test:pure` with `--coverage`):

| file | tests | what |
|------|-------|------|
| `pure/ExportDetection.test.ts` | 12 | isExported text scanning against fixture |
| `pure/Signatures.test.ts` | 12 | extractSignature, extractDocComment edge cases |

**Integration tests** (`src/*.test.ts`, 48 tests, `test:integration`):

| file | tests | what |
|------|-------|------|
| `Cochange.test.ts` | 3 | ranked neighbors, empty result, db missing |
| `Lsp.test.ts` | 8 | documentSymbol, hierarchical children, semanticTokens, updateOpenDocument, prepareCallHierarchy, incomingCalls, shutdown |
| `ExportDetection.integration.test.ts` | 3 | LSP spike — semantic tokens don't distinguish exports |
| `Symbols.test.ts` | 12 | zoom levels, directory zoom, FileNotFoundError, signatures, workspace boundary, size cap |
| `Mcp.test.ts` | 11 | MCP integration via InMemoryTransport, cochange, zoom, impact, structuredContent |
| `call-hierarchy-spike.test.ts` | 6 | BFS latency measurement across kart + varp symbols |

LSP-dependent tests use `describe.skipIf(!hasLsp)`. Fixture files in `src/__fixtures__/`.

**Coverage (all tests):**

| module | functions | lines |
|--------|-----------|-------|
| pure/ExportDetection.ts | 100% | 100% |
| pure/Signatures.ts | 100% | 100% |
| Symbols.ts | 94% | 100% |
| Cochange.ts | 80% | 100% |
| Tools.ts | 100% | 100% |
| Lsp.ts | 70% | 92% |
| Mcp.ts | 88% | 89% |
| **all files** | **79%** | **94%** |

## dependencies

```
effect              — service layer (Context.Tag, Layer, ManagedRuntime, Data.TaggedError)
@effect/platform    — (available, not heavily used in v0.1)
@effect/platform-bun — (available, not heavily used in v0.1)
@modelcontextprotocol/sdk — MCP server + InMemoryTransport for tests
zod                 — tool input schemas
bun:sqlite          — read-only cochange queries
```
