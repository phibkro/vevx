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
    types.ts             — DocumentSymbol, LspRange, ZoomSymbol, ZoomResult
    Errors.ts            — 3 Data.TaggedError types
    ExportDetection.ts   — isExported() pure text scanner
    Signatures.ts        — extractSignature, extractDocComment, findBodyOpenBrace, symbolKindName
  Lsp.ts                 — LspClient service, JsonRpcTransport, LspClientLive layer
  Symbols.ts             — SymbolIndex service, toZoomSymbol, zoomDirectory
  Cochange.ts            — CochangeDb service, SQL query, graceful degradation
  Tools.ts               — kart_zoom + kart_cochange tool definitions
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
- `shutdown()` — explicit early termination (sets flag to prevent duplicate cleanup in finalizer)

**File watching:** Deferred to v0.2. The LS falls back to polling or stale state. A TODO in the code marks where `workspace/didChangeWatchedFiles` registration should go.

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

`Mcp.ts` registers tools individually with typed handlers. All responses include `structuredContent` for direct JSON access by callers. Effect errors become `{ isError: true, content: [{ text: "Error: ..." }] }`.

## error model

| error | type | when |
|-------|------|------|
| `LspError` | `Data.TaggedError` | LS spawn failure, handshake timeout, malformed response |
| `LspTimeoutError` | `Data.TaggedError` | individual LSP request exceeds 30s deadline |
| `FileNotFoundError` | `Data.TaggedError` | requested path doesn't exist |
| `CochangeUnavailable` | plain object | `.varp/cochange.db` absent — structured return, not error |

All error types defined in `src/pure/Errors.ts`.

## testing

56 tests across 7 files, split into pure (coverage-gated) and integration:

**Pure tests** (`src/pure/`, 24 tests, `test:pure` with `--coverage`):

| file | tests | what |
|------|-------|------|
| `pure/ExportDetection.test.ts` | 12 | isExported text scanning against fixture |
| `pure/Signatures.test.ts` | 12 | extractSignature, extractDocComment edge cases |

**Integration tests** (`src/*.test.ts`, 32 tests, `test:integration`):

| file | tests | what |
|------|-------|------|
| `Cochange.test.ts` | 3 | ranked neighbors, empty result, db missing |
| `Lsp.test.ts` | 4 | documentSymbol, hierarchical children, semanticTokens, shutdown |
| `ExportDetection.integration.test.ts` | 3 | LSP spike — semantic tokens don't distinguish exports |
| `Symbols.test.ts` | 12 | zoom levels, directory zoom, FileNotFoundError, signatures, workspace boundary, size cap |
| `Mcp.test.ts` | 10 | MCP integration via InMemoryTransport, structuredContent | |

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
