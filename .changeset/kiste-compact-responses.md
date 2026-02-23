---
"@vevx/kiste": patch
---

Compact MCP tool responses to reduce agent context window usage. `get_artifact` caps commits to 5 most recent with total count, `search` and `get_provenance` drop unused `conv_type`/`conv_scope` fields, `list_artifacts` drops internal `id` field, and `get_provenance` drops redundant echoed path and count.
