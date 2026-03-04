# @vevx/kart

IDE interface for AI coding agents. Progressive code disclosure, LSP-backed navigation, AST-aware editing. 24 MCP tools spanning zoom, search, impact analysis, imports, diagnostics, and structural editing. TypeScript (oxc-parser + typescript-language-server) and Rust (tree-sitter + rust-analyzer). Standalone — no dependencies on other vevx packages.

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
| `src/Mcp.ts` | `dist/Mcp.js` | MCP server (stdio transport, 24 tools) |

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
| `kart_diagnostics` | Lint violations + type errors via oxlint (TS) / cargo clippy (Rust) |
| `kart_references` | Cross-file references for a symbol via LSP |
| `kart_definition` | Go to definition of a symbol via LSP |
| `kart_type_definition` | Go to type definition of a symbol via LSP |
| `kart_implementation` | Find implementations of an interface/trait via LSP |
| `kart_code_actions` | Available code actions at a symbol's position via LSP |
| `kart_expand_macro` | Expand a Rust macro via rust-analyzer |
| `kart_inlay_hints` | Inferred types and parameter names for a file or range via LSP |
| `kart_imports` | File import list with resolved paths and symbol names (TS + Rust) |
| `kart_importers` | Reverse import lookup with barrel file expansion (TS + Rust) |
| `kart_unused_exports` | Find exported symbols not imported by any other file |
| `kart_workspace_symbol` | Search workspace symbols by name via LSP `workspace/symbol` |

### Write tools

| Tool | Purpose |
|---|---|
| `kart_replace` | Replace a symbol's full definition with syntax validation + oxlint diagnostics (TS + Rust). Optional `format` param. |
| `kart_insert_after` | Insert content after a symbol's definition (TS + Rust). Optional `format` param. |
| `kart_insert_before` | Insert content before a symbol's definition (TS + Rust). Optional `format` param. |
| `kart_rename` | Reference-aware rename across workspace via LSP |
| `kart_restart` | Restart all language server runtimes (clears caches) |

### kart_zoom

```
kart_zoom(path, level?, resolveTypes?)
```

| Level | Content | When to use |
|-------|---------|-------------|
| 0 (default) | Exported symbols + signatures + doc comments + resolved types | "What does this module expose?" |
| 1 | All symbols + signatures + doc comments + resolved types | "How does this module work?" |
| 2 | Full file content (capped at 100KB) | "I need to read the implementation" |

Levels 0 and 1 include `resolvedType` on each symbol — the LSP-resolved type from hover (e.g. inferred return types, expanded type aliases). Set `resolveTypes: false` to skip hover calls for faster scanning.

When `path` is a directory, behavior depends on level:
- **Level 0** (default): compact summary — file name + export count via oxc-parser (no LSP needed, fast)
- **Level 1+**: full symbol signatures with LSP-resolved types (same as file zoom)

Files with no exports are omitted in both modes.

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

Returns a tree of callers with metadata: `totalNodes`, `highFanOut` (warns when any node exceeds 10 callers), `depth`, `maxDepth`. Uses per-language `LspRuntimes` (lazy, routed by file extension via `PluginRegistry`).

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
kart_replace(file, symbol, content, format?)
```

Replaces a symbol's full definition. Pipeline: read → locate → validate new content syntax → splice → validate full file → write → format (if requested) → oxlint (best effort). Uses oxc-parser for TS/TSX and tree-sitter for Rust. Returns `EditResult` with inline diagnostics.

Set `format: true` to auto-format after edit with `oxfmt` (TS) or `rustfmt` (Rust). Returns `formatted: boolean` and `formattingError` if formatting fails.

### kart_insert_after / kart_insert_before

```
kart_insert_after(file, symbol, content, format?)
kart_insert_before(file, symbol, content, format?)
```

Insert content after or before a symbol's definition. Same pipeline as `kart_replace` (skip content-level syntax check since inserts may be partial). Works with both TS/TSX and Rust files. Supports `format` param.

### kart_rename

```
kart_rename(file, symbol, newName)
```

Reference-aware rename via LSP `textDocument/rename`. Applies edits bottom-up to preserve offsets, validates workspace boundaries, and notifies the LSP of changes.

### kart_diagnostics

```
kart_diagnostics(paths)
```

Auto-routes by file extension: `.ts`/`.tsx` → `oxlint --type-aware --format json`, `.rs` → `cargo clippy --message-format json`. Returns structured diagnostics. Graceful degradation when either tool is unavailable (`oxlintAvailable: false` or `clippyAvailable: false`).

### kart_references

```
kart_references(path, symbol, includeDeclaration?)
```

Finds all references to a symbol across the workspace via LSP. Returns file paths, positions, and total count.

### kart_definition

```
kart_definition(path, symbol)
```

Go to the definition of a symbol. Returns file paths and positions where the symbol is defined. Works across files via LSP `textDocument/definition`.

### kart_type_definition

```
kart_type_definition(path, symbol)
```

Go to the type definition of a symbol. Returns where the type of the symbol is defined. Useful for navigating through type aliases and inferred types. Via LSP `textDocument/typeDefinition`.

### kart_implementation

```
kart_implementation(path, symbol)
```

Find implementations of an interface, trait, or abstract class. Returns file paths and positions of all concrete implementations. Via LSP `textDocument/implementation`.

### kart_code_actions

```
kart_code_actions(path, symbol)
```

Get available code actions (quick fixes, refactorings) at a symbol's position. Returns action titles and kinds without applying them. Via LSP `textDocument/codeAction`.

### kart_expand_macro

```
kart_expand_macro(path, symbol)
```

Expand a Rust macro at a symbol's position. Returns the expanded source code. Only works with `.rs` files via `rust-analyzer/expandMacro`.

### kart_inlay_hints

```
kart_inlay_hints(path, startLine?, endLine?)
```

Returns compiler-inferred type annotations and parameter names that aren't written in source. Useful for understanding implicit types without reading implementation. If `startLine`/`endLine` are omitted, returns hints for the entire file.

### kart_imports

```
kart_imports(path)
```

Returns what a file imports: raw specifiers, resolved absolute paths, imported symbol names, and type-only status. Uses oxc-parser for extraction and `Bun.resolveSync` for tsconfig-aware resolution. No LSP required.

### kart_importers

```
kart_importers(path)
```

Returns all files that import the given file. Barrel files (index.ts that only re-export) are expanded transparently — if `auth/index.ts` re-exports from `auth/session.ts`, then `kart_importers("auth/session.ts")` includes files that import via the barrel. Supports both TypeScript and Rust files. No LSP required.

### kart_unused_exports

```
kart_unused_exports()
```

Scans all `.ts`/`.tsx`/`.rs` files in the workspace. Reports exported symbols that no other file imports. Barrel files (index.ts with only re-exports) are excluded. Namespace imports are treated conservatively as using all exports.

### kart_workspace_symbol

```
kart_workspace_symbol(query)
```

LSP `workspace/symbol` search — returns symbols matching the query across the entire workspace. More accurate than `kart_find` for cross-file symbol resolution since it uses the language server's full understanding of the project. Returns name, kind, URI, range, and optional container name.

## Plugin Assets

| Asset | Path | Purpose |
|---|---|---|
| Skill | `skills/zoom/` | Decision guide for zoom levels and kart vs serena |
| Hooks | `hooks/hooks.json` | SessionStart + SubagentStart prompt hooks for progressive disclosure |
| Plugin manifest | `.claude-plugin/` | plugin.json |

## Modules

| Module | File | Purpose |
|---|---|---|
| Types | `src/core/types.ts` | DocumentSymbol, ZoomSymbol, ZoomResult, CallHierarchyItem, ImpactNode, ImpactResult, DepsNode, DepsResult, ImportEntry, FileImports, ImportGraph, ImportsResult, ImportersResult, DefinitionResult, TypeDefinitionResult, ImplementationResult, CodeActionsResult, ExpandMacroResult, InlayHint, InlayHintsResult |
| Errors | `src/core/Errors.ts` | LspError, LspTimeoutError, FileNotFoundError |
| ExportDetection | `src/core/ExportDetection.ts` | `isExported(symbol, lines)` text scanner |
| Signatures | `src/core/Signatures.ts` | `extractSignature`, `extractDocComment`, `symbolKindName` |
| OxcSymbols | `src/core/OxcSymbols.ts` | Fast TypeScript symbol extraction via oxc-parser (LSP-free) |
| RustSymbols | `src/core/RustSymbols.ts` | Rust symbol extraction via tree-sitter (LSP-free) |
| AstEdit | `src/core/AstEdit.ts` | Symbol location, syntax validation, byte-range splicing (TS + Rust dispatch) |
| Resolve | `src/core/Resolve.ts` | tsconfig path alias resolution (`loadTsconfigPaths`, `resolveAlias`, `resolveSpecifier`, `bunResolve`) |
| ImportGraph | `src/core/ImportGraph.ts` | oxc-based import extraction, import graph construction, barrel-aware transitive importers |
| Plugin | `src/Plugin.ts` | `AstPlugin`, `LspPlugin`, `PluginRegistry` interfaces, `makeRegistry`, `PluginUnavailableError` |
| TsPlugin | `src/TsPlugin.ts` | TypeScript plugins — `TsAstPluginImpl` (oxc), `TsLspPluginImpl` (typescript-language-server) |
| RustPlugin | `src/RustPlugin.ts` | Rust plugins — `makeRustAstPlugin` (tree-sitter), `RustLspPluginImpl` (rust-analyzer) |
| PluginLayers | `src/PluginLayers.ts` | `makeRegistryFromPlugins`, `LspRuntimes` service, `makeLspRuntimes` |
| LspClient | `src/Lsp.ts` | Language server over stdio (JSON-RPC, Effect Layer, file watcher). Parameterized via `LspPlugin`. |
| SymbolIndex | `src/Symbols.ts` | Zoom + impact + deps + references + rename — workspace-scoped, combines LSP + pure functions |
| CochangeDb | `src/Cochange.ts` | SQLite reader for co-change data (cached connections) |
| Find | `src/Find.ts` | Workspace-wide symbol search via oxc-parser (TS) / tree-sitter (Rust), mtime-cached |
| Search | `src/Search.ts` | Text pattern search via ripgrep subprocess |
| List | `src/List.ts` | Directory listing with glob filtering |
| Editor | `src/Editor.ts` | AST-aware edit pipeline (locate → validate → splice → write → format → lint, TS + Rust) |
| Diagnostics | `src/Diagnostics.ts` | oxlint (TS) + cargo clippy (Rust) with graceful degradation |
| Imports | `src/Imports.ts` | Import graph queries — `getImports`, `getImporters` with barrel expansion |
| Tools | `src/Tools.ts` | 24 MCP tool definitions (Zod schemas + Effect/async handlers) |
| Mcp | `src/Mcp.ts` | Server entrypoint, `PluginRegistry` + `LspRuntimes` wiring |

`src/core/` contains deterministic modules with no IO — 100% function coverage, 99% line coverage enforced. Effectful modules (`Lsp.ts`, `Symbols.ts`, `Cochange.ts`) have integration tests without coverage gates. Stateless modules (`Search.ts`, `List.ts`, `Editor.ts`, `Diagnostics.ts`, `Imports.ts`) and cached modules (`Find.ts` — mtime-based symbol cache) are tested without Effect runtime.

## Relationship to Other vevx Packages

**kiste** — git-backed artifact index. Builds the co-change database that `kart_cochange` queries. Integration is file-based (`.varp/cochange.db`) — no package dependency.

**varp** — architectural awareness via manifest, dependency graph, and agent orchestration. Independent of kart.

**havn** — default plugin setup and agent configuration templates. Provides scaffolding that wires kart into projects.

## Stack

- **Runtime**: Bun
- **Core**: Effect TS (`effect`, `@effect/platform`)
- **LSP**: `typescript-language-server` (TS), `rust-analyzer` (Rust) — managed subprocess, for zoom/impact/deps/references/rename
- **TS Parser**: `oxc-parser` (for find/edit — fast, LSP-free)
- **Rust Parser**: `web-tree-sitter` with `tree-sitter-wasms` (for find + edit — fast, LSP-free)
- **MCP**: `@modelcontextprotocol/sdk`
- **Validation**: Zod

See `architecture.md` for service graph and data flow.
