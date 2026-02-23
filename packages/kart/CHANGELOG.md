# @vevx/kart

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
