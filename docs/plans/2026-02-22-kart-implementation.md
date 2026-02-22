# kart implementation plan

Phase 0 of the kart design (v0.2). Effect TS package providing `kart_zoom` and `kart_cochange` as MCP tools.

## architecture

### service layer

```
ManagedRuntime (singleton, built at server startup)
  └─ LspClient (acquireRelease — spawns TS language server, kills on shutdown)
  └─ SymbolIndex (pure logic over LspClient — zoom level filtering)
  └─ CochangeDb (read-only sqlite via @effect/sql-sqlite-bun)
```

All tool calls share one `ManagedRuntime`. No per-request layer construction.

### services

| service | tag | deps | responsibility |
|---------|-----|------|----------------|
| `LspClient` | `kart/LspClient` | none (Bun.spawn internally) | LSP process lifecycle, JSON-RPC over stdio, file watcher registration |
| `SymbolIndex` | `kart/SymbolIndex` | `LspClient` | zoom level logic: documentSymbol → export detection → structured output |
| `CochangeDb` | `kart/CochangeDb` | none (@effect/sql-sqlite-bun) | read-only queries against `.varp/cochange.db` |

### errors

| error | tag | when |
|-------|-----|------|
| `LspError` | `LspError` | spawn failure, handshake timeout, malformed response |
| `LspTimeoutError` | `LspTimeoutError` | individual LSP request exceeds deadline |
| `FileNotFoundError` | `FileNotFoundError` | requested path doesn't exist |

`CochangeUnavailable` is a typed return value, not an error — the MCP handler returns it as structured JSON the agent can act on.

### file structure

```
packages/kart/
  src/
    Errors.ts         # Data.TaggedError types
    Lsp.ts            # LspClient service + LspLive layer
    Symbols.ts        # SymbolIndex service — zoom levels, export detection
    Cochange.ts       # CochangeDb service — sqlite read-only client
    Tools.ts          # MCP tool definitions (Zod input schemas) + Effect handlers
    Mcp.ts            # Entrypoint: ManagedRuntime, stdio transport, tool registration
    Mcp.test.ts       # Integration tests: InMemoryTransport + mocked LspClient
  package.json
  tsconfig.json
  design.md           # (existing)
```

## implementation waves

### wave 1: foundation

No LSP dependency — scaffolding and the simpler tool.

**1a. package scaffolding**
- `package.json` with effect, @effect/platform, @effect/platform-bun, @effect/sql, @effect/sql-sqlite-bun, @modelcontextprotocol/sdk, zod
- `tsconfig.json` extending root `tsconfig.base.json`
- `src/Errors.ts` — all TaggedError types

**1b. CochangeDb service + kart_cochange tool**
- `src/Cochange.ts`: `CochangeDb` service with `Context.Tag`
- `CochangeDbLive` layer: opens `.varp/cochange.db` with `SQLITE_OPEN_READONLY`
- If db file absent: return `CochangeUnavailable` typed value (not error)
- Query: ranked neighbors by coupling score (SQL from design doc)
- `src/Tools.ts`: `kart_cochange` tool with Zod input schema
- `src/Mcp.ts`: minimal entrypoint — `ManagedRuntime` with `CochangeDbLive`, stdio transport
- Test: mock sqlite responses, verify structured output and unavailable case

**acceptance**: `bun run build` succeeds, `kart_cochange` returns neighbors or unavailable response.

### wave 2: LSP client

The core infrastructure — language server lifecycle.

**2a. LspClient service**
- `src/Lsp.ts`: `LspClient` service tag
- Interface: `initialize()`, `documentSymbol(path)`, `semanticTokens(path)`, `shutdown()`
- `LspClientLive` layer using `Effect.acquireRelease`:
  - **acquire**: `Bun.spawn(["typescript-language-server", "--stdio"])`, LSP `initialize` handshake, register file watchers (`workspace/didChangeWatchedFiles`) for `**/*.ts`, `**/*.tsx`, `tsconfig.json`, `package.json`
  - **release**: send LSP `shutdown` → `exit`, kill process
- JSON-RPC framing: `Content-Length` header parsing over stdio streams
- Request/response correlation via incrementing `id`
- Auto-restart: if the LS process exits unexpectedly, `LspClient` methods retry by re-acquiring

**2b. file watcher registration**
- During `initialize`, send `client/registerCapability` for `workspace/didChangeWatchedFiles`
- Watch patterns: `**/*.ts`, `**/*.tsx`, `tsconfig.json`, `package.json`
- On `workspace/didChangeWatchedFiles` notification from kart → forward to LS so its view stays current

**acceptance**: LspClient spawns `typescript-language-server`, completes handshake, responds to `documentSymbol` requests, shuts down cleanly.

### wave 3: zoom levels + export detection

The primary value prop — `kart_zoom`.

**3a. export detection spike**
- Try `textDocument/semanticTokens/full` first: check if token modifiers include `declaration` + semantic info that distinguishes exported vs internal symbols
- Fallback strategy: for each symbol from `documentSymbol`, read the text range and scan for `^export` at the declaration line
- Document which strategy works and under what conditions
- This is the riskiest part of phase 0 — spike early, don't build SymbolIndex until the detection strategy is validated

**3b. SymbolIndex service**
- `src/Symbols.ts`: `SymbolIndex` service tag, depends on `LspClient`
- `zoom(path, level)` method:
  - Level 2: read and return full file content (no LSP needed)
  - Level 1: `documentSymbol` → all symbols with signatures and doc comments, bodies omitted
  - Level 0: level-1 filtered to exported symbols only (using validated detection strategy)
- Signature extraction: use the symbol's range from `documentSymbol` to extract the declaration line
- Doc comment extraction: scan backwards from symbol start for `/** ... */` blocks
- Directory zoom: when path is a directory, iterate files, return level-0 for each, omit files with no exports

**3c. kart_zoom tool**
- Add to `src/Tools.ts`: Zod input schema (`path: string`, `level?: 0 | 1 | 2`)
- Handler calls `SymbolIndex.zoom()`, formats result as `ZoomResult`
- Update `Mcp.ts`: add `LspClientLive` and `SymbolIndexLive` to the `ManagedRuntime` layer

**acceptance**: `kart_zoom("src/some-file.ts", 0)` returns only exported symbols with signatures. `kart_zoom("src/some-dir/")` returns aggregate level-0 across files.

### wave 4: integration + polish

**4a. integration tests**
- `src/Mcp.test.ts`: use `InMemoryTransport.createLinkedPair()` + MCP `Client`
- Test `kart_zoom` end-to-end with a real `typescript-language-server` against fixture `.ts` files
- Test `kart_cochange` with a fixture `.varp/cochange.db`
- Test graceful degradation: missing db, missing file, LS crash recovery

**4b. monorepo integration**
- Add `@varp/kart` to root `package.json` workspaces
- Add to `turbo.json` pipeline
- Add to `.mcp.json` for local development
- Update `varp.yaml` with kart component

**acceptance**: `turbo build` includes kart, `turbo test` runs kart tests, `turbo check` passes.

## key design decisions

**ManagedRuntime, not per-request layers.** The `LspClient` layer is built once at server startup via `ManagedRuntime.make()`. All MCP tool handlers call `runtime.runPromise(effect)`. The language server process lives for the duration of the MCP server process.

**Read-only sqlite.** `CochangeDb` opens `.varp/cochange.db` with `SQLITE_OPEN_READONLY`. kart never writes to kiste's database. If the db doesn't exist, the tool returns a structured `CochangeUnavailable` value — the MCP handler serializes it as JSON, not as an error.

**Export detection is the phase-0 risk.** `documentSymbol` doesn't indicate export status. The spike in wave 3a must validate one of: (a) semantic tokens with export modifier, (b) text scanning for `export` keyword at the symbol's declaration line. If neither is reliable, level-0 degrades to level-1 (all symbols, not just exports) with a `"note": "export filtering unavailable"` field. This is an acceptable degradation — level-0 still provides progressive disclosure, just without the export filter.

**File watcher registration during handshake.** `LspClientLive.acquire` registers `workspace/didChangeWatchedFiles` watchers for `**/*.ts`, `**/*.tsx`, `tsconfig.json`, `package.json`. This keeps the language server's view current without a restart tool. The watchers use `WatchKind.Create | WatchKind.Change | WatchKind.Delete`.

**Zod at MCP boundary, Effect internally.** MCP tool input schemas use Zod (matches `@modelcontextprotocol/sdk` expectations). Internal service interfaces, config, and domain types use Effect Schema. Error types use `Data.TaggedError`.

## dependencies

```json
{
  "effect": "^3.19.0",
  "@effect/platform": "^0.94.0",
  "@effect/platform-bun": "^0.87.0",
  "@effect/sql": "^0.49.0",
  "@effect/sql-sqlite-bun": "^0.50.0",
  "@modelcontextprotocol/sdk": "^1.9.0",
  "zod": "^3.24.0"
}
```

Same versions as kiste. No additional dependencies needed — LSP JSON-RPC framing is simple enough to implement directly (Content-Length headers over stdio).

## risks

| risk | likelihood | mitigation |
|------|-----------|------------|
| export detection unreliable | medium | spike in wave 3a before building SymbolIndex; graceful degradation to level-1 |
| typescript-language-server not installed | low | check `node_modules/.bin/` first, fall back to global, error with install instructions |
| LSP startup latency on large projects | medium | lazy init (first tool call triggers spawn); timeout with clear error |
| sqlite version mismatch with kiste | low | pin same @effect/sql-sqlite-bun version; read-only mode prevents schema issues |
