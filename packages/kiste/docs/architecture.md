# Kiste Architecture

Git-backed artifact index. Git is the event store, SQLite is the derived read model, MCP exposes read-only queries.

## System Overview

```
git log --name-status
    │
    ▼
Indexer (Effect pipeline)
    │  parse commits → extract tags → upsert artifacts → link relationships
    ▼
SQLite (.kiste/index.sqlite)
    │  metadata + tags + FTS (no file content)
    ├──▶ CLI queries (kiste status, kiste query)
    └──▶ MCP tools (kiste_list_artifacts, kiste_search, ...)
              │
              ▼
          Agents / Claude Code
```

Content is never stored in SQLite. `git show <ref>:<path>` reads it on demand.

## Effect TS Service Graph

Three services composed via `Layer.mergeAll`:

```
BunRuntime.runMain
  └─ Layer.mergeAll(
       ConfigLive(repoDir),    // Layer<Config, ConfigError>
       DbLive(dbPath),         // Layer<SqliteClient | SqlClient, ConfigError>
       GitLive                 // Layer<Git>
     )
```

| Service | Tag | Provides | Requirements |
|---|---|---|---|
| `Config` | `@kiste/Config` | Parsed `.kiste.yaml` with defaults | None (reads file in layer construction) |
| `SqlClient` | `@effect/sql/SqlClient` | SQLite connection | None (path provided at layer construction) |
| `Git` | `kiste/Git` | `revParse`, `log`, `show` | None (`Bun.spawnSync` is self-contained, input validation on `show`) |

All three layers have no upstream requirements — they compose via `Layer.mergeAll` without ordering constraints.

## Typed Error Hierarchy

```
Data.TaggedError
  ├─ ConfigError   { message }           — config parse/read failures
  ├─ GitError      { command, stderr }    — git CLI failures
  ├─ IndexError    { message, cause? }    — indexing pipeline failures
  └─ DbError       { message, cause? }    — SQL execution failures
```

Errors are tagged (discriminated unions). Callers can pattern-match with `Effect.catchTag`.

## Data Model

```
artifacts ──< artifact_commits >── commits
    │                                  │
    ├──< artifact_tags                 ├── commits_fts (FTS5)
    │                                  │
    └──< tag_operations >──────────────┘
```

- `artifacts`: one row per file path ever seen. `alive` flag tracks current HEAD state.
- `commits`: one row per git commit. `conv_type`/`conv_scope` from conventional commit parsing.
- `artifact_commits`: join table. Primary query: artifact → commits ("what touched this file?").
- `artifact_tags`: materialized current tag state per artifact.
- `tag_operations`: full add/remove history for tag replay during rebuild.
- `commits_fts`: FTS5 virtual table over commit messages, auto-populated via trigger. Queries are sanitized — special FTS5 operators are stripped to prevent injection.
- `meta`: key-value store for `last_indexed_sha` (incremental indexing checkpoint).
- `idx_artifact_commits_sha`: index on `artifact_commits.commit_sha` for join performance.

## Entry Points

| Entry | File | Build output | Purpose |
|---|---|---|---|
| CLI | `src/Cli.ts` | `dist/Cli.js` | `kiste init\|index\|status\|query` |
| MCP | `src/Mcp.ts` | `dist/Mcp.js` | 5 read-only MCP tools over stdio |

Both built with `bun build --target bun`. CLI uses `@effect/cli` with `BunRuntime.runMain`. MCP uses `@modelcontextprotocol/sdk` with `StdioServerTransport`.

The MCP server resolves config once at startup via `createServer({ repoDir, dbPath? })`. Tools receive a pre-built effect runner — they never see infrastructure paths. Server config via env vars: `KISTE_REPO_DIR`, `KISTE_DB_PATH`.

## Key Design Decisions

- **No content in SQLite** — git is the content store. SQLite only has metadata, tags, relationships.
- **One index per repo root** — cross-component co-change data is the highest-value signal.
- **Server-level config, not per-tool** — `db_path` and `repo_dir` are resolved once at MCP server startup. Tools only accept semantic parameters (tags, paths, queries). Callers never specify infrastructure paths.
- **Bun.spawnSync for git** — pragmatic choice over `@effect/platform Command` which would leak `CommandExecutor` into the service interface.
- **Zod for MCP, Effect Schema elsewhere** — MCP SDK requires Zod for tool input schemas.
- **Layers provided per-command in CLI** — avoids opening SQLite during `--help` or `init`.
- **FTS trigger is AFTER INSERT only** — commits use `INSERT OR IGNORE`. If DDL ever changes to `INSERT OR REPLACE`, the trigger would create duplicate FTS entries.
- **Transaction batching** — `processCommits` wraps bulk indexing in a single SQLite transaction (BEGIN/COMMIT) for performance. Rollback on failure.
- **Input validation** — `Git.show` rejects shell metacharacters and `..` path traversal. `kiste_search` sanitizes FTS5 queries (strips special operators).
- **Gitignore filtering** — `kiste_list_artifacts` excludes gitignored files by default (configurable via `include_ignored` parameter).
- **structuredContent** — all MCP tool responses include `structuredContent` for direct JSON access alongside `content` text.
