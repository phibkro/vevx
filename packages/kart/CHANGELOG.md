# @vevx/kart

## 0.2.0

### Minor Changes

- 8aac587: Add `kart_impact` tool for symbol blast radius analysis via LSP call hierarchy. BFS over `incomingCalls` with depth 3 default, cap 5, fan-out metadata, and cycle prevention. Also adds `outgoingCalls` to LspClient, `structuredContent` to all MCP tool responses, and `errorMessage` helper for Effect FiberFailure extraction.

## 0.1.1

### Patch Changes

- a9be6f0: Security and performance hardening: add workspace boundary check to prevent path traversal in zoom, cap level-2 file reads at 100KB, and cache readonly SQLite connections in CoChange for reuse across requests.
