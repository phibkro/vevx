---
"@vevx/kart": minor
---

Add cargo clippy support to `kart_diagnostics`. Auto-routes by file extension: `.ts`/`.tsx` → oxlint, `.rs` → cargo clippy. Graceful degradation when either tool is unavailable.
