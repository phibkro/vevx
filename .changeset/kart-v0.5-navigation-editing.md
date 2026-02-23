---
"@vevx/kart": minor
---

Add navigation and editing tools — kart can now serve as a standalone TypeScript code agent.

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
