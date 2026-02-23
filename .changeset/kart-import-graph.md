---
"@vevx/kart": minor
---

Add import graph tools and improve pure module coverage.

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
