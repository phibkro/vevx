# @vevx/kart

## 0.6.0

### Minor Changes

- ed672f1: Add compact directory zoom at level 0 (oxc-based export counts, no LSP) and MCP integration tests for kart_deps, kart_workspace_symbol, kart_inlay_hints

### Patch Changes

- 6a11175: Compact MCP tool responses to reduce agent context window usage. `kart_find` strips debug metadata (`durationMs`, `cachedFiles`). `kart_impact` and `kart_deps` strip `range` from tree nodes and convert absolute `uri` to workspace-relative `path`.

## 0.5.0

### Minor Changes

- 6195093: Add `kart_inlay_hints` tool — returns compiler-inferred type annotations and parameter names via LSP `textDocument/inlayHint`. Supports optional line range.

  Add `format` parameter to `kart_replace`, `kart_insert_after`, `kart_insert_before` — auto-formats after edit with oxfmt (TS) or rustfmt (Rust). Graceful degradation when formatter unavailable.

- 6195093: Add 5 new LSP-backed tools: `kart_definition`, `kart_type_definition`, `kart_implementation`, `kart_code_actions`, `kart_expand_macro`. Navigate to definitions, find implementations of interfaces/traits, get available code actions, and expand Rust macros.
- 6195093: Add cargo clippy support to `kart_diagnostics`. Auto-routes by file extension: `.ts`/`.tsx` → oxlint, `.rs` → cargo clippy. Graceful degradation when either tool is unavailable.
- 6195093: Add Rust file support for `kart_replace`, `kart_insert_after`, `kart_insert_before` via tree-sitter AST. Add LSP hover integration for `kart_zoom` — levels 0 and 1 now include `resolvedType` on each symbol with compiler-inferred types.
- 4772119: Add Rust import graph support, workspace symbol search, and file watcher cache invalidation.

  - **Rust imports**: `kart_imports` and `kart_importers` now support `.rs` files via tree-sitter `use` statement parsing with `crate::`/`self::`/`super::` path resolution
  - **`kart_workspace_symbol`**: new tool — LSP `workspace/symbol` search across the entire workspace (24th tool)
  - **Watch mode**: file watcher automatically evicts changed `.ts`/`.tsx`/`.rs` files from the symbol cache, so `kart_find` always returns fresh results
  - **Inlay hints tests**: added test coverage for `inlayHints` and `workspaceSymbol` LSP methods

## 0.4.0

### Minor Changes

- 97df88f: Add mtime-cached symbol index for kart_find. First call scans the full workspace in parallel; subsequent calls only re-parse changed files. Removes the 2000-file cap. kart_restart clears the cache.

## 0.3.0

### Minor Changes

- 41090ef: Add `kart_deps` tool for symbol dependency analysis via BFS over LSP `outgoingCalls`. Returns transitive callees — the inverse of `kart_impact`. Together they give agents a complete view of a symbol's neighborhood before modifying it.
- 82bdb5a: Add import graph tools and improve pure module coverage.

  **Import graph (Phase 9):**

  - `kart_imports` — what a file imports: resolved paths, symbol names, type-only status (oxc-parser + Bun.resolveSync)
  - `kart_importers` — reverse import lookup with transparent barrel file expansion

  **Foundation:**

  - `Resolve` pure module — tsconfig path alias resolution with extends chain support
  - `ImportGraph` pure module — oxc-based import extraction, graph construction, barrel-aware transitive importers

  **Also shipped (Phase 4–8, pending changesets):**

  - `kart_diagnostics` — oxlint `--type-aware` lint + type errors
  - `kart_references` — cross-file symbol references via LSP
  - `kart_rename` — reference-aware rename via LSP

  15 tools total. Pure module coverage: 100% functions, 99% lines (95 tests).

- a005753: Add navigation and editing tools — kart can now serve as a standalone TypeScript code agent.

  **Navigation (Phase 4a):**

  - `kart_find` — workspace-wide symbol search via oxc-parser (by name, kind, export status)
  - `kart_search` — text pattern search via ripgrep (gitignore-aware)
  - `kart_list` — directory listing with recursive and glob support

  **Editing (Phase 4b):**

  - `kart_replace` — replace a symbol's definition with syntax validation + oxlint diagnostics
  - `kart_insert_after` / `kart_insert_before` — insert content relative to a symbol

  **Foundation:**

  - `OxcSymbols` pure module — fast symbol extraction from TypeScript/TSX via oxc-parser
  - `AstEdit` pure module — symbol location, syntax validation, byte-range splicing

## 0.2.0

### Minor Changes

- 8aac587: Add `kart_impact` tool for symbol blast radius analysis via LSP call hierarchy. BFS over `incomingCalls` with depth 3 default, cap 5, fan-out metadata, and cycle prevention. Also adds `outgoingCalls` to LspClient, `structuredContent` to all MCP tool responses, and `errorMessage` helper for Effect FiberFailure extraction.

## 0.1.1

### Patch Changes

- a9be6f0: Security and performance hardening: add workspace boundary check to prevent path traversal in zoom, cap level-2 file reads at 100KB, and cache readonly SQLite connections in CoChange for reuse across requests.
