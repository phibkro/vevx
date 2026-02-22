---
"@vevx/kart": minor
---

Add `kart_impact` tool for symbol blast radius analysis via LSP call hierarchy. BFS over `incomingCalls` with depth 3 default, cap 5, fan-out metadata, and cycle prevention. Also adds `outgoingCalls` to LspClient, `structuredContent` to all MCP tool responses, and `errorMessage` helper for Effect FiberFailure extraction.
