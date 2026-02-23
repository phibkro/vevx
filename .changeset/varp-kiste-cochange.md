---
"@vevx/varp": minor
---

Enrich `varp_suggest_touches` with behavioral coupling from kiste's co-change index. When `.kiste/index.sqlite` exists, `suggestTouches` now surfaces read dependencies for components that frequently co-change in git history but aren't statically linked via imports. Falls back gracefully when kiste isn't indexed.
