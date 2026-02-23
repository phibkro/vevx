# @vevx/varp

## 0.2.0

### Minor Changes

- 683854b: Enrich `varp_suggest_touches` with behavioral coupling from kiste's co-change index. When `.kiste/index.sqlite` exists, `suggestTouches` now surfaces read dependencies for components that frequently co-change in git history but aren't statically linked via imports. Falls back gracefully when kiste isn't indexed.

### Patch Changes

- 4c7bde1: Compact MCP tool responses to reduce agent context window usage. Freshness reports only list stale docs, manifest returns component summaries, import scans strip per-file evidence, env checks only list missing vars, and co-change analysis returns summary stats instead of raw edges.

## 0.1.1

### Patch Changes

- a9be6f0: Fix MCP tool responses to always return structuredContent, ensuring clients receive typed JSON alongside the text fallback. Fixes outputSchema validation errors for tools with declared output schemas.
