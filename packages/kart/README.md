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
| `src/Mcp.ts` | `dist/Mcp.js` | MCP server (stdio transport, 17 tools) |

## MCP Tools

### Read-only tools

| Tool | Purpose |
|---|---|
| `kart_zoom` | Progressive disclosure of a file or directory's structure |
| `kart_cochange` | Files that frequently change alongside a given file (from git history) |
| `kart_impact` | Blast radius of changing a symbol — transitive callers via LSP call hierarchy |
| `kart_deps` | Dependencies of a symbol — transitive callees via LSP call hierarchy |
| `kart_find` | Search for symbols across the workspace by name, kind, or export status |
| `kart_search` | Text pattern search via ripgrep (gitignore-aware) |
| `kart_list` | List files and directories with recursive and glob support |
| `kart_diagnostics` | Lint violations + type errors via oxlint `--type-aware` |
| `kart_references` | Cross-file references for a symbol via LSP |
| `kart_imports` | File import list with resolved paths and symbol names |
| `kart_importers` | Reverse import lookup with barrel file expansion |

### Write tools

| Tool | Purpose |
|---|---|
| `kart_replace` | Replace a symbol's full definition with syntax validation + oxlint diagnostics |
| `kart_insert_after` | Insert content after a symbol's definition |
| `kart_insert_before` | Insert content before a symbol's definition |
| `kart_rename` | Reference-aware rename across workspace via LSP |

### kart_zoom

```
kart_zoom(path, level?)
```

| Level | Content | When to use |
|-------|---------|-------------|
| 0 (default) | Exported symbols + signatures + doc comments | "What does this module expose?" |
| 1 | All symbols + signatures + doc comments | "How does this module work?" |
| 2 | Full file content (capped at 100KB) | "I need to read the implementation" |

When `path` is a directory, returns level-0 for each `.ts`/`.tsx`/`.rs` file. Files with no exports are omitted.

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

Lists transitive dependencies (callees) of a symbol. BFS over LSP `outgoingCalls`. Same parameters and defaults as `kart_impact`.

### kart_find

```
kart_find(name, kind?, exported?, path?)
```

Searches `.ts`/`.tsx`/`.rs` files for symbols matching a name substring. Uses `oxc-parser` for TypeScript and `tree-sitter` for Rust — fast, LSP-free scanning. Results are cached by file mtime — first call scans the full workspace, subsequent calls are near-instant. Optional filters for symbol kind and export status.

### kart_search

```
kart_search(pattern, glob?, paths?)
```

Searches file contents via ripgrep. Gitignore-aware by default. Caps at 100 matches. Supports glob filtering and path restriction.

### kart_list

```
kart_list(path, recursive?, glob?)
```

Lists files and directories. Excludes `node_modules`, `.git`, `dist`, `build`, `.varp`. Supports recursive mode and glob filtering. Caps at 5000 entries.

### kart_cochange

```
kart_cochange(path)
```

Returns co-change neighbors ranked by coupling score from `.varp/cochange.db`. Database connections are cached for reuse across requests. If the database is absent, returns a structured message telling the agent how to generate it.

### kart_replace

```
kart_replace(file, symbol, content)
```

Replaces a symbol's full definition. Pipeline: read → locate (oxc-parser) → validate new content syntax → splice → validate full file → write → oxlint (best effort). Returns `EditResult` with inline diagnostics.

### kart_insert_after / kart_insert_before

```
kart_insert_after(file, symbol, content)
kart_insert_before(file, symbol, content)
```

Insert content after or before a symbol's definition. Same pipeline as `kart_replace` (skip content-level syntax check since inserts may be partial).

### kart_rename

```
kart_rename(file, symbol, newName)
```

Reference-aware rename via LSP `textDocument/rename`. Applies edits bottom-up to preserve offsets, validates workspace boundaries, and notifies the LSP of changes.

### kart_diagnostics

```
kart_diagnostics(paths)
```

Runs `oxlint --type-aware --format json` on the given paths. Returns structured diagnostics. If oxlint/tsgolint is unavailable, returns `{ oxlintAvailable: false }`.

### kart_references

```
kart_references(path, symbol, includeDeclaration?)
```

Finds all references to a symbol across the workspace via LSP. Returns file paths, positions, and total count.

### kart_imports

```
kart_imports(path)
```

Returns what a file imports: raw specifiers, resolved absolute paths, imported symbol names, and type-only status. Uses oxc-parser for extraction and `Bun.resolveSync` for tsconfig-aware resolution. No LSP required.

### kart_importers

```
kart_importers(path)
```

Returns all files that import the given file. Barrel files (index.ts that only re-export) are expanded transparently — if `auth/index.ts` re-exports from `auth/session.ts`, then `kart_importers("auth/session.ts")` includes files that import via the barrel. No LSP required.

## Plugin Assets

| Asset | Path | Purpose |
|---|---|---|
| Skill | `skills/zoom/` | Decision guide for zoom levels and kart vs serena |
| Hooks | `hooks/hooks.json` | SessionStart + SubagentStart prompt hooks for progressive disclosure |
| Plugin manifest | `.claude-plugin/` | plugin.json |

## Modules

| Module | File | Purpose |
|---|---|---|
| Types | `src/pure/types.ts` | DocumentSymbol, ZoomSymbol, ZoomResult, CallHierarchyItem, ImpactNode, ImpactResult, DepsNode, DepsResult, ImportEntry, FileImports, ImportGraph, ImportsResult, ImportersResult |
| Errors | `src/pure/Errors.ts` | LspError, LspTimeoutError, FileNotFoundError |
| ExportDetection | `src/pure/ExportDetection.ts` | `isExported(symbol, lines)` text scanner |
| Signatures | `src/pure/Signatures.ts` | `extractSignature`, `extractDocComment`, `symbolKindName` |
| OxcSymbols | `src/pure/OxcSymbols.ts` | Fast TypeScript symbol extraction via oxc-parser (LSP-free) |
| RustSymbols | `src/pure/RustSymbols.ts` | Rust symbol extraction via tree-sitter (LSP-free) |
| AstEdit | `src/pure/AstEdit.ts` | Symbol location, syntax validation, byte-range splicing |
| Resolve | `src/pure/Resolve.ts` | tsconfig path alias resolution (`loadTsconfigPaths`, `resolveAlias`, `resolveSpecifier`, `bunResolve`) |
| ImportGraph | `src/pure/ImportGraph.ts` | oxc-based import extraction, import graph construction, barrel-aware transitive importers |
| LspClient | `src/Lsp.ts` | Language server over stdio (JSON-RPC, Effect Layer, file watcher). Parameterized for TS and Rust. |
| SymbolIndex | `src/Symbols.ts` | Zoom + impact + deps + references + rename — workspace-scoped, combines LSP + pure functions |
| CochangeDb | `src/Cochange.ts` | SQLite reader for co-change data (cached connections) |
| Find | `src/Find.ts` | Workspace-wide symbol search via oxc-parser (TS) / tree-sitter (Rust), mtime-cached |
| Search | `src/Search.ts` | Text pattern search via ripgrep subprocess |
| List | `src/List.ts` | Directory listing with glob filtering |
| Editor | `src/Editor.ts` | AST-aware edit pipeline (locate → validate → splice → write → lint) |
| Diagnostics | `src/Diagnostics.ts` | oxlint `--type-aware` integration with graceful degradation |
| Imports | `src/Imports.ts` | Import graph queries — `getImports`, `getImporters` with barrel expansion |
| Tools | `src/Tools.ts` | 17 MCP tool definitions (Zod schemas + Effect/async handlers) |
| Mcp | `src/Mcp.ts` | Server entrypoint, per-tool ManagedRuntime |

`src/pure/` contains deterministic modules with no IO — 100% function coverage, 99% line coverage enforced. Effectful modules (`Lsp.ts`, `Symbols.ts`, `Cochange.ts`) have integration tests without coverage gates. Stateless modules (`Search.ts`, `List.ts`, `Editor.ts`, `Diagnostics.ts`, `Imports.ts`) and cached modules (`Find.ts` — mtime-based symbol cache) are tested without Effect runtime.

## Relationship to Other Tools

**serena** — symbol search, references, type hierarchies. Heavyweight LSP integration with cross-language support.

**kart** — context management, navigation, and editing. TypeScript (oxc-parser + typescript-language-server) and Rust (tree-sitter + rust-analyzer). Fast parser-based scanning for navigation + LSP for cross-reference tools.

**varp** — architectural manifest, dependency graph, agent orchestration. Independent of kart.

**kiste** — git-backed artifact index. Builds the co-change database that `kart_cochange` queries. Integration is file-based (`.varp/cochange.db`) — no package dependency.

## Stack

- **Runtime**: Bun
- **Core**: Effect TS (`effect`, `@effect/platform`)
- **LSP**: `typescript-language-server` (TS), `rust-analyzer` (Rust) — managed subprocess, for zoom/impact/deps/references/rename
- **TS Parser**: `oxc-parser` (for find/edit — fast, LSP-free)
- **Rust Parser**: `web-tree-sitter` with `tree-sitter-wasms` (for find — fast, LSP-free)
- **MCP**: `@modelcontextprotocol/sdk`
- **Validation**: Zod

See `architecture.md` for service graph and data flow.
