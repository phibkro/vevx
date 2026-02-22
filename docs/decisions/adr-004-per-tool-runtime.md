# ADR-004: Per-tool ManagedRuntime in kart

**Status:** Accepted
**Date:** 2026-02-22
**Author:** Philip
**Deciders:** Philip (sole maintainer)

## Context

kart is an MCP server providing two tools: `kart_zoom` (progressive code disclosure via LSP) and `kart_cochange` (behavioral coupling from a SQLite database). The original design used a single shared `ManagedRuntime` for both tools, with all services composed into one `Layer`.

During implementation, a problem emerged: the LSP startup is the most fragile part of the system. It requires `typescript-language-server` to be installed, a valid TypeScript project in the workspace, and a successful JSON-RPC handshake. Any of these can fail. If both tools share one runtime, an LSP startup failure takes down `kart_cochange` too — even though cochange has no LSP dependency.

## Decision

Give each tool its own `ManagedRuntime` with only the services it needs:

```
McpServer
  ├─ cochangeRuntime → CochangeDb (bun:sqlite, read-only)
  └─ zoomRuntime     → SymbolIndex → LspClient (typescript-language-server)
```

`kart_cochange` uses `cochangeRuntime` (SQLite only). `kart_zoom` uses `zoomRuntime` (LSP + symbol index). Neither runtime initializes until its first use (`ManagedRuntime` is lazy).

## Consequences

**Positive:**

- LSP failure is isolated. `kart_cochange` works even when `typescript-language-server` is missing, the workspace has no `tsconfig.json`, or the handshake times out. This is the primary value — the most likely failure mode doesn't degrade unrelated functionality.
- Each runtime initializes lazily on first tool call. If `kart_zoom` is never called, the LSP process is never spawned.
- Testing is simpler. Cochange tests don't need to set up a TypeScript project or wait for LSP initialization. The `describe.skipIf(!hasLsp)` pattern applies only to zoom tests.

**Negative:**

- Two runtimes instead of one. Marginal memory overhead (negligible — `CochangeDb` has no persistent state, and `ManagedRuntime` is lightweight).
- Tool registration in `Mcp.ts` is slightly more verbose: each tool handler calls `runPromise` on its own runtime rather than a shared one.

## Alternatives Considered

**Single shared runtime with error recovery.** Catch LSP errors at the tool handler level and return structured errors for `kart_zoom` while letting `kart_cochange` proceed normally. Rejected because `ManagedRuntime.make` evaluates the full layer graph at first use — if the LSP layer fails during `cochangeRuntime.runPromise(cochangeEffect)`, the cochange effect never runs. Error isolation at the handler level doesn't help when the runtime itself fails to initialize.

**Separate MCP servers.** Run `kart_zoom` and `kart_cochange` as two independent MCP servers. Rejected because it doubles the configuration burden (two entries in `.mcp.json`) and two server processes for what is conceptually one tool suite. Per-tool runtimes within a single server achieves the same isolation without the operational overhead.
