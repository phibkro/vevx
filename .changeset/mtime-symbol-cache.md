---
"@vevx/kart": minor
---

Add mtime-cached symbol index for kart_find. First call scans the full workspace in parallel; subsequent calls only re-parse changed files. Removes the 2000-file cap. kart_restart clears the cache.
