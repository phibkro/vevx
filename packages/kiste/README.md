# @vevx/kiste

Semantic artifact index over git history. Tags, provenance, and full-text search — no content duplication, no migration.

## Quick Start

```bash
kiste init          # Create .kiste/ and .kiste.yaml
kiste index         # Index all commits
kiste index --rebuild  # Full reindex from scratch
kiste status        # Index summary
kiste query --tags auth,security  # Find artifacts by tag
```

## Entry Points

| Entry | Build output | Purpose |
|---|---|---|
| `src/Cli.ts` | `dist/Cli.js` | CLI binary (`kiste init|index|status|query`) |
| `src/Mcp.ts` | `dist/Mcp.js` | MCP server (stdio transport, 5 read-only tools) |

## MCP Tools

| Tool | Purpose |
|---|---|
| `kiste_list_tags` | All tags with artifact counts |
| `kiste_list_artifacts` | Browse artifacts, filter by tags |
| `kiste_get_artifact` | File content (from git) + tags + commits |
| `kiste_search` | Full-text search over commit messages (FTS5) |
| `kiste_get_provenance` | Full commit history for a file path |

All tools are read-only. Content is read from git on demand — SQLite stores only metadata, tags, and relationships.

## Plugin Assets

| Asset | Path | Purpose |
|---|---|---|
| Skills | `skills/` | 3 SKILL.md files (index, query, context) |
| Hooks | `hooks/` | 2 lifecycle hooks (session-start, post-commit) |
| Plugin manifest | `.claude-plugin/` | plugin.json, marketplace.json |

## How It Works

Git is the event store. Kiste builds a derived SQLite index over commit history:

```
git log --name-status  →  Indexer (Effect pipeline)  →  SQLite (.kiste/index.sqlite)
                                                            ├── CLI queries
                                                            └── MCP tools → Agents
```

Tags come from two sources:
- **Folder-derived** — automatic from file paths (configurable via `.kiste.yaml`)
- **Commit-declared** — `tags: +auth, -legacy` in commit body (conventional commits extended)

## Modules

| Module | File | Purpose |
|---|---|---|
| Config | `src/Config.ts` | Parse `.kiste.yaml`, provide defaults |
| Db | `src/Db.ts` | Schema DDL, meta key-value store |
| Git | `src/Git.ts` | Git CLI wrapper (log, show, rev-parse) |
| Indexer | `src/Indexer.ts` | Incremental + full reindex pipeline |
| Tags | `src/Tags.ts` | Conventional commit parsing, tag derivation, tag ops |
| Tools | `src/Tools.ts` | MCP tool definitions |
| Mcp | `src/Mcp.ts` | MCP server factory + stdio entry point |
| Cli | `src/Cli.ts` | CLI commands via @effect/cli |
| Errors | `src/Errors.ts` | Typed error hierarchy (ConfigError, GitError, IndexError, DbError) |

## Stack

- **Runtime**: Bun
- **Core**: Effect TS (`effect`, `@effect/platform`, `@effect/sql`, `@effect/cli`)
- **Database**: SQLite via `@effect/sql-sqlite-bun`
- **MCP**: `@modelcontextprotocol/sdk`
- **Validation**: Zod (MCP tool schemas), Effect Schema (internal)

See `docs/architecture.md` for service graph, data model, and design decisions.
