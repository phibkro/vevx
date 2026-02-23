# @vevx/kart

Progressive code disclosure and behavioral coupling for agents. Zoom into modules at the right depth — from public contract to full implementation — without loading everything.

## Quick Start

```json
// .mcp.json
{
  "mcpServers": {
    "kart": {
      "command": "bun",
      "args": ["packages/kart/dist/Mcp.js"]
    }
  }
}
```

Or install via the vevx marketplace:

```
/plugin marketplace add ./
/plugin install kart@vevx
```

## Entry Points

| Entry | Build output | Purpose |
|---|---|---|
| `src/Mcp.ts` | `dist/Mcp.js` | MCP server (stdio transport, 4 read-only tools) |

## MCP Tools

| Tool | Purpose |
|---|---|
| `kart_zoom` | Progressive disclosure of a file or directory's structure |
| `kart_cochange` | Files that frequently change alongside a given file (from git history) |
| `kart_impact` | Blast radius of changing a symbol — transitive callers via LSP call hierarchy |
| `kart_deps` | Dependencies of a symbol — transitive callees via LSP call hierarchy |

### kart_zoom

```
kart_zoom(path, level?)
```

| Level | Content | When to use |
|-------|---------|-------------|
| 0 (default) | Exported symbols + signatures + doc comments | "What does this module expose?" |
| 1 | All symbols + signatures + doc comments | "How does this module work?" |
| 2 | Full file content (capped at 100KB) | "I need to read the implementation" |

When `path` is a directory, returns level-0 for each `.ts` file. Files with no exports are omitted.

Paths are validated against the workspace root — requests outside the workspace boundary are rejected.

### kart_impact

```
kart_impact(path, symbol, depth?)
```

Computes the blast radius of changing a symbol. BFS over LSP `incomingCalls` to find transitive callers.

| Parameter | Default | Description |
|-----------|---------|-------------|
| `path` | required | File containing the symbol |
| `symbol` | required | Name of the symbol to analyze |
| `depth` | 3 | BFS depth limit (1–5). Higher depths may be slow on large codebases. |

Returns a tree of callers with metadata: `totalNodes`, `highFanOut` (warns when any node exceeds 10 callers), `depth`, `maxDepth`. Uses `zoomRuntime` (shares LSP with `kart_zoom`).

### kart_deps

```
kart_deps(path, symbol, depth?)
```

Lists the dependencies of a symbol. BFS over LSP `outgoingCalls` to find transitive callees — the inverse of `kart_impact`.

| Parameter | Default | Description |
|-----------|---------|-------------|
| `path` | required | File containing the symbol |
| `symbol` | required | Name of the symbol to analyze |
| `depth` | 3 | BFS depth limit (1–5). |

Returns a tree of callees with the same metadata shape as `kart_impact`: `totalNodes`, `highFanOut`, `depth`, `maxDepth`. Together with `kart_impact`, gives agents a complete view of a symbol's neighborhood.

### kart_cochange

```
kart_cochange(path)
```

Returns co-change neighbors ranked by coupling score from `.varp/cochange.db`. Database connections are cached for reuse across requests. If the database is absent, returns a structured message telling the agent how to generate it.

## Plugin Assets

| Asset | Path | Purpose |
|---|---|---|
| Skill | `skills/zoom/` | Decision guide for zoom levels and kart vs serena |
| Hooks | `hooks/hooks.json` | SessionStart + SubagentStart prompt hooks for progressive disclosure |
| Plugin manifest | `.claude-plugin/` | plugin.json |

## Modules

| Module | File | Purpose |
|---|---|---|
| Types | `src/pure/types.ts` | DocumentSymbol, ZoomSymbol, ZoomResult, CallHierarchyItem, ImpactNode, ImpactResult, DepsNode, DepsResult |
| Errors | `src/pure/Errors.ts` | LspError, LspTimeoutError, FileNotFoundError |
| ExportDetection | `src/pure/ExportDetection.ts` | `isExported(symbol, lines)` text scanner |
| Signatures | `src/pure/Signatures.ts` | `extractSignature`, `extractDocComment`, `symbolKindName` |
| LspClient | `src/Lsp.ts` | TypeScript language server over stdio (JSON-RPC, Effect Layer, file watcher) |
| SymbolIndex | `src/Symbols.ts` | Zoom + impact + deps services — workspace-scoped, combines LSP + pure functions |
| CochangeDb | `src/Cochange.ts` | SQLite reader for co-change data (cached connections) |
| Tools | `src/Tools.ts` | MCP tool definitions (Zod schemas + Effect handlers) |
| Mcp | `src/Mcp.ts` | Server entrypoint, per-tool ManagedRuntime |

`src/pure/` contains deterministic modules with no IO — 100% test coverage enforced. Effectful modules (`Lsp.ts`, `Symbols.ts`, `Cochange.ts`) have integration tests without coverage gates.

## Relationship to Other Tools

**serena** — symbol search, references, type hierarchies, editing. Use when you know what you're looking for.

**kart** — context management and architectural impact. Use when you're orienting.

**varp** — architectural manifest, dependency graph, agent orchestration. Independent of kart.

**kiste** — git-backed artifact index. Builds the co-change database that `kart_cochange` queries. Integration is file-based (`.varp/cochange.db`) — no package dependency.

## Stack

- **Runtime**: Bun
- **Core**: Effect TS (`effect`, `@effect/platform`)
- **LSP**: `typescript-language-server` (managed subprocess)
- **MCP**: `@modelcontextprotocol/sdk`
- **Validation**: Zod

See `docs/design.md` for the full vision, roadmap, and design decisions. See `docs/architecture.md` for current implementation details and data flow.
