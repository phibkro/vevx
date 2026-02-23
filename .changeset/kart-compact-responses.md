---
"@vevx/kart": patch
---

Compact MCP tool responses to reduce agent context window usage. `kart_find` strips debug metadata (`durationMs`, `cachedFiles`). `kart_impact` and `kart_deps` strip `range` from tree nodes and convert absolute `uri` to workspace-relative `path`.
