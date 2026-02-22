---
"@vevx/kart": minor
---

Add `kart_deps` tool for symbol dependency analysis via BFS over LSP `outgoingCalls`. Returns transitive callees — the inverse of `kart_impact`. Together they give agents a complete view of a symbol's neighborhood before modifying it.
