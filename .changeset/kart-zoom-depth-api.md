---
"@vevx/kart": minor
---

Redesign zoom API: replace level/resolveTypes with depth-based BFS type graph traversal

- New parameters: `depth` (BFS hops through type dependencies), `visibility` (exported/all), `kind` (declaration filter), `deep` (include non-imported type refs)
- DeclCache: `tsc --declaration --emitDeclarationOnly --incremental` generates `.d.ts` files in `.kart/decls/` with staleness detection
- TypeRefs: pure module extracting type references from `.d.ts` content for BFS traversal
- BFS follows import chains across files, returning referenced declarations as `referencedFiles`
- Graceful fallback to LSP documentSymbol when tsc is unavailable or visibility=all
