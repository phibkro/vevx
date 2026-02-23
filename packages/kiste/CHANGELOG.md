# @vevx/kiste

## 0.3.0

### Minor Changes

- 993e89b: Add `kiste_get_cochange` MCP tool for behavioral coupling queries (co-changing files ranked by frequency with jaccard similarity) and snapshot support for resilient indexing (create/restore via CLI, auto-trigger at configured frequency).
- ed672f1: Add `kiste_tag` write tool for manual artifact tagging and expand default stop_tags to filter noisy directories

### Patch Changes

- 6a11175: Compact MCP tool responses to reduce agent context window usage. `get_artifact` caps commits to 5 most recent with total count, `search` and `get_provenance` drop unused `conv_type`/`conv_scope` fields, `list_artifacts` drops internal `id` field, and `get_provenance` drops redundant echoed path and count.

## 0.2.0

### Minor Changes

- 0f02122: Add Claude Code plugin: MCP server registration, 3 skills (index, query, context), 2 hooks (session-start auto-index, post-commit incremental index), marketplace listing, and README.

### Patch Changes

- a9be6f0: Security and performance hardening: sanitize FTS5 MATCH input to prevent query injection, validate git ref/path inputs against shell metacharacters and path traversal, wrap bulk indexing in transactions, add index on artifact_commits.commit_sha for join performance, and return structuredContent in MCP responses.
