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
| `src/Mcp.ts` | `dist/Mcp.js` | MCP server (stdio transport, 2 read-only tools) |

## MCP Tools

| Tool | Purpose |
|---|---|
| `kart_zoom` | Progressive disclosure of a file or directory's structure |
| `kart_cochange` | Files that frequently change alongside a given file (from git history) |

### kart_zoom

```
kart_zoom(path, level?)
```

| Level | Content | When to use |
|-------|---------|-------------|
| 0 (default) | Exported symbols + signatures + doc comments | "What does this module expose?" |
| 1 | All symbols + signatures + doc comments | "How does this module work?" |
| 2 | Full file content | "I need to read the implementation" |

When `path` is a directory, returns level-0 for each `.ts` file. Files with no exports are omitted.

### kart_cochange

```
kart_cochange(path)
```

Returns co-change neighbors ranked by coupling score from `.varp/cochange.db`. If the database is absent, returns a structured message telling the agent how to generate it.

## Plugin Assets

| Asset | Path | Purpose |
|---|---|---|
| Skill | `skills/zoom/` | Decision guide for zoom levels and kart vs serena |
| Hooks | `hooks/hooks.json` | SessionStart + SubagentStart prompt hooks for progressive disclosure |
| Plugin manifest | `.claude-plugin/` | plugin.json |

## Modules

| Module | File | Purpose |
|---|---|---|
| Types | `src/pure/types.ts` | DocumentSymbol, ZoomSymbol, ZoomResult (plain data) |
| Errors | `src/pure/Errors.ts` | LspError, LspTimeoutError, FileNotFoundError |
| ExportDetection | `src/pure/ExportDetection.ts` | `isExported(symbol, lines)` text scanner |
| Signatures | `src/pure/Signatures.ts` | `extractSignature`, `extractDocComment`, `symbolKindName` |
| LspClient | `src/Lsp.ts` | TypeScript language server over stdio (JSON-RPC, Effect Layer) |
| SymbolIndex | `src/Symbols.ts` | Zoom service — combines LSP + pure functions |
| CochangeDb | `src/Cochange.ts` | SQLite reader for co-change data |
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

See `design.md` for architecture, algorithms, and design decisions. See `architecture.md` for service graph and data flow.
