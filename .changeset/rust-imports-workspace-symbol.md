---
"@vevx/kart": minor
---

Add Rust import graph support, workspace symbol search, and file watcher cache invalidation.

- **Rust imports**: `kart_imports` and `kart_importers` now support `.rs` files via tree-sitter `use` statement parsing with `crate::`/`self::`/`super::` path resolution
- **`kart_workspace_symbol`**: new tool — LSP `workspace/symbol` search across the entire workspace (24th tool)
- **Watch mode**: file watcher automatically evicts changed `.ts`/`.tsx`/`.rs` files from the symbol cache, so `kart_find` always returns fresh results
- **Inlay hints tests**: added test coverage for `inlayHints` and `workspaceSymbol` LSP methods
