---
"@vevx/kiste": patch
---

Security and performance hardening: sanitize FTS5 MATCH input to prevent query injection, validate git ref/path inputs against shell metacharacters and path traversal, wrap bulk indexing in transactions, add index on artifact_commits.commit_sha for join performance, and return structuredContent in MCP responses.
