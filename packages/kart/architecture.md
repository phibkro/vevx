# kart architecture

## overview

kart is an MCP server providing progressive code disclosure and behavioral coupling data. Two tools: `kart_zoom` (zoom levels on file/directory structure) and `kart_cochange` (co-change neighbors from git history).

```
MCP client ──stdio──▷ Mcp.ts (McpServer + ManagedRuntime)
                        │
              ┌─────────┴──────────┐
              ▼                    ▼
        cochangeRuntime       zoomRuntime
              │                    │
        CochangeDb           SymbolIndex
        (bun:sqlite)              │
                              LspClient
                        (typescript-language-server)
```

Each tool has its own `ManagedRuntime` — LSP failure doesn't block cochange queries.

## services

### LspClient (`src/Lsp.ts`)

Manages a persistent `typescript-language-server` process over JSON-RPC/stdio.

**Lifecycle:** `Layer.scoped` + `Scope.addFinalizer`. Spawns the LS on first use, kills on scope disposal. The scope is tied to the `ManagedRuntime` — which lives for the entire MCP server process.

**JSON-RPC transport:** `JsonRpcTransport` class handles Content-Length framing with a `Uint8Array` byte buffer (not string — Content-Length counts bytes, not characters). Request/response correlation via incrementing integer IDs. Pending requests stored in a `Map<number, { resolve, reject }>`.

**Binary resolution:** `node_modules/.bin/typescript-language-server` first, `Bun.which()` fallback.

**Methods:**
- `documentSymbol(uri)` — hierarchical symbol tree for a file
- `semanticTokens(uri)` — decoded semantic tokens (delta-encoded from LSP)
- `shutdown()` — explicit early termination (sets flag to prevent duplicate cleanup in finalizer)

**File watching:** Deferred to v0.2. The LS falls back to polling or stale state. A TODO in the code marks where `workspace/didChangeWatchedFiles` registration should go.

### SymbolIndex (`src/Symbols.ts`)

Depends on `LspClient`. Transforms raw LSP responses into structured zoom results.

**Zoom levels:**

| level | source | content |
|-------|--------|---------|
| 0 | LSP `documentSymbol` + text scan | exported symbols only, signatures, doc comments |
| 1 | LSP `documentSymbol` | all symbols, signatures, doc comments |
| 2 | `readFileSync` | full file content (no LSP) |

**Signature extraction** (`extractSignature`): walks source lines from symbol start, looking for the first `{` that opens a body block. Handles string literals, parens, and angle brackets via `findBodyOpenBrace`. Stops at `;` for bodyless declarations (type aliases, const).

**Doc comment extraction** (`extractDocComment`): scans backwards from symbol start, skipping blank lines and decorators (`@`), looking for a `*/` → `/**` block.

**Export detection** (`src/ExportDetection.ts`): checks if the line at `symbol.range.start.line` starts with `export `. Semantic tokens don't distinguish exports (validated empirically — the modifier sets are identical for exported and non-exported symbols).

**Directory zoom:** when path is a directory, returns level-0 for each `.ts`/`.tsx` file (non-recursive, test files excluded). Files with no exports are omitted.

### CochangeDb (`src/Cochange.ts`)

Read-only SQLite client for `.varp/cochange.db` (owned by kiste).

**Per-call open:** opens the database on each `neighbors()` call, closes after. Correct because kiste can rebuild the database at any time — a persistent connection could see stale data.

**Read-only mode:** `{ readonly: true }` on the `bun:sqlite` `Database` constructor. kart never writes to kiste's index.

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
       ├─ toZoomSymbol: extractSignature + extractDocComment + isExported
       └─ [level 0] → filter to exported only
```

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

`Mcp.ts` registers tools individually with typed handlers. Error handling at the MCP boundary: Effect errors become `{ isError: true, content: [{ text: "Error: ..." }] }`.

## error model

| error | type | when |
|-------|------|------|
| `LspError` | `Data.TaggedError` | LS spawn failure, handshake timeout, malformed response |
| `LspTimeoutError` | `Data.TaggedError` | individual LSP request exceeds 30s deadline |
| `FileNotFoundError` | `Data.TaggedError` | requested path doesn't exist |
| `CochangeUnavailable` | plain object | `.varp/cochange.db` absent — structured return, not error |

## testing

49 tests across 5 files:

| file | tests | what |
|------|-------|------|
| `Cochange.test.ts` | 3 | ranked neighbors, empty result, db missing |
| `Lsp.test.ts` | 4 | documentSymbol, hierarchical children, semanticTokens, shutdown |
| `ExportDetection.test.ts` | 15 | 12 pure function + 3 LSP integration |
| `Symbols.test.ts` | 20 | 7 extractSignature/docComment + 8 zoom levels + 5 pure helpers |
| `Mcp.test.ts` | 7 | MCP integration via InMemoryTransport |

LSP-dependent tests use `describe.skipIf(!hasLsp)`. Fixture files in `src/__fixtures__/`.

## dependencies

```
effect              — service layer (Context.Tag, Layer, ManagedRuntime, Data.TaggedError)
@effect/platform    — (available, not heavily used in v0.1)
@effect/platform-bun — (available, not heavily used in v0.1)
@modelcontextprotocol/sdk — MCP server + InMemoryTransport for tests
zod                 — tool input schemas
bun:sqlite          — read-only cochange queries
```

## file map

```
src/
  Errors.ts            15 lines — 3 Data.TaggedError types
  ExportDetection.ts   45 lines — isExported() pure function
  Lsp.ts              530 lines — LspClient service, JsonRpcTransport, LspClientLive layer
  Symbols.ts          325 lines — SymbolIndex service, signature/doc extraction, directory zoom
  Cochange.ts          85 lines — CochangeDb service, SQL query, graceful degradation
  Tools.ts             55 lines — kart_zoom + kart_cochange tool definitions
  Mcp.ts              105 lines — MCP server entrypoint, per-tool ManagedRuntime
  __fixtures__/        — test fixtures (exports.ts, other.ts, tsconfig.json)
```
