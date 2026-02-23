---
"@vevx/kart": minor
---

Add `kart_inlay_hints` tool — returns compiler-inferred type annotations and parameter names via LSP `textDocument/inlayHint`. Supports optional line range.

Add `format` parameter to `kart_replace`, `kart_insert_after`, `kart_insert_before` — auto-formats after edit with oxfmt (TS) or rustfmt (Rust). Graceful degradation when formatter unavailable.
