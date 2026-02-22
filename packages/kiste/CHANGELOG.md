# @vevx/kiste

## 0.2.0

### Minor Changes

- 0f02122: Add Claude Code plugin: MCP server registration, 3 skills (index, query, context), 2 hooks (session-start auto-index, post-commit incremental index), marketplace listing, and README.

### Patch Changes

- a9be6f0: Security and performance hardening: sanitize FTS5 MATCH input to prevent query injection, validate git ref/path inputs against shell metacharacters and path traversal, wrap bulk indexing in transactions, add index on artifact_commits.commit_sha for join performance, and return structuredContent in MCP responses.
