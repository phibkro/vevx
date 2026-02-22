---
"@vevx/kart": patch
---

Security and performance hardening: add workspace boundary check to prevent path traversal in zoom, cap level-2 file reads at 100KB, and cache readonly SQLite connections in CoChange for reuse across requests.
