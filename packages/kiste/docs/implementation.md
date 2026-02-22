# Kiste Implementation Details

For architecture overview, see [architecture.md](./architecture.md).
For design rationale, see [design.md](./design.md).

---

## Module Map

```
src/
├── Errors.ts           4 TaggedError classes (pure data, no logic)
├── Config.ts           Config schema + service + layer
├── Tags.ts             Pure functions: path→tags, tag parsing, conventional commits
├── Db.ts               SQLite DDL, meta helpers, DbLive layer factory
├── Git.ts              Git service: log parsing, rev-parse, show
├── Indexer.ts          Orchestrator: git→sqlite pipeline
├── Tools.ts            5 MCP tool definitions (factory: makeTools(run, repoDir))
├── tool-registry.ts    Generic ToolDef→McpServer registration
├── Mcp.ts              MCP server entry point (createServer + stdio)
├── Cli.ts              CLI entry point (4 subcommands)
├── index.ts            Package barrel export
├── Config.test.ts      Config schema + layer tests
├── Tags.test.ts        Pure function tests (18 cases)
├── Indexer.test.ts     Integration tests with temp git repos (4 cases)
└── Tools.test.ts       MCP tool tests via InMemoryTransport (5 cases)
```

---

## Config (`Config.ts`)

Effect Schema with `Schema.optionalWith` for defaults:

| Field | Type | Default |
|---|---|---|
| `strip_prefixes` | `string[]` | `["src", "lib", "components", "app", "pages"]` |
| `stop_tags` | `string[]` | `["index", "utils", "helpers", "types"]` |
| `snapshot_frequency` | `number` | `500` |
| `exclude` | `string[]` | `["node_modules/**", "dist/**", "*.lock"]` |
| `db_path` | `string` | `".kiste/index.sqlite"` |

`ConfigLive(repoDir)` reads `{repoDir}/.kiste.yaml` via `Bun.YAML.parse`. Missing file or all-comment YAML returns defaults.

---

## Tag Derivation (`Tags.ts`)

Pure functions — no Effect, no side effects, fully testable in isolation.

### `deriveTagsFromPath(path, config) → string[]`

1. Split path into segments
2. Drop filename (last segment)
3. Strip leading segments matching `strip_prefixes` (greedy)
4. Filter out segments matching `stop_tags`

Example: `src/auth/session/handler.ts` → `["auth", "session"]` (strips `src`, keeps `auth`, `session`, drops `handler.ts`)

### `parseTagLine(body) → TagOp[] | null`

Finds `tags: ...` line in commit body. Parses comma-separated tags with `+`/`-` prefixes.

```
tags: +session, -auth, redis
→ [{tag:"session", op:"add"}, {tag:"auth", op:"remove"}, {tag:"redis", op:"add"}]
```

### `parseConventionalCommit(subject) → {type, scope} | null`

Extracts type and optional scope from conventional commit subjects. `feat(auth): add rate limiting` → `{type:"feat", scope:"auth"}`.

### `applyTagOperations(currentSet, ops) → Set<string>`

Replays add/remove operations on a tag set. Used during tag materialization.

---

## Git Service (`Git.ts`)

### Service Interface

```typescript
class Git extends Context.Tag("kiste/Git")<Git, {
  revParse: (cwd, ref?) => Effect<string, GitError>
  log: (cwd, since?) => Effect<RawCommit[], GitError>
  show: (cwd, ref, path) => Effect<string, GitError>
}>() {}
```

### `GitLive` — production implementation

Uses `Bun.spawnSync` wrapped in `Effect.try`. No `@effect/platform` dependency.

- `revParse`: `git rev-parse HEAD` → trimmed SHA
- `log`: `git log --pretty=format:<delimited> --name-status [since..HEAD]` → parsed, reversed (oldest first)
- `show`: `git show <ref>:<path>` → file content

### Log Parser (`parseGitLogOutput`)

Custom delimiter-based parser (not line-by-line). Handles:
- Multi-line commit bodies
- `--name-status` format: `M\tpath`, `A\tpath`, `D\tpath`, `R100\told\tnew`
- Renames: old path marked deleted, new path marked added

The format string uses `---KISTE-COMMIT---` and `---KISTE-FILES---` delimiters to avoid ambiguity with commit content.

---

## Database (`Db.ts`)

### Schema

7 tables + 1 FTS virtual table + 1 trigger. All created via `CREATE TABLE IF NOT EXISTS` (idempotent).

`initSchema` runs all DDL statements through `sql.unsafe()` since DDL can't use tagged templates.

The FTS trigger is `AFTER INSERT` only. Commits use `INSERT OR IGNORE`, so the trigger won't fire on ignored duplicates (correct). If the insert strategy ever changes to `INSERT OR REPLACE`, the trigger would need to handle deletions to avoid duplicate FTS entries.

### Meta Helpers

- `getLastIndexedSha` → `string | null` — reads checkpoint from `meta` table
- `setLastIndexedSha(sha)` — `INSERT OR REPLACE` into `meta` table

### `DbLive(dbPath)`

Factory returning `Layer<SqliteClient | SqlClient>`. Thin wrapper over `SqliteClient.layer({ filename })`.

---

## Indexer (`Indexer.ts`)

The core orchestrator. Two public functions:

### `rebuildIndex(cwd)`

Full reindex: fetches all commits, processes each, saves last SHA as checkpoint.

### `incrementalIndex(cwd)`

Reads `last_indexed_sha` from meta. If present, fetches only `since..HEAD`. Otherwise falls back to full index.

### `processCommits` (internal)

Sequential loop over commits. For each commit, calls `indexCommit`.

### `indexCommit` (internal)

Per-commit pipeline:

1. Parse conventional commit subject → `conv_type`, `conv_scope`
2. Parse tag line from body → `TagOp[]`
3. `INSERT OR IGNORE` commit row
4. For each file in commit:
   - Upsert artifact (set `alive = 1`)
   - Link `artifact_commits`
   - Record `tag_operations` if tag line present
5. For each deleted file:
   - Upsert artifact (set `alive = 0`)
   - Link `artifact_commits`
6. For each affected artifact: `materializeTags`

### `materializeTags` (internal)

Per-artifact tag computation:

1. Derive folder tags from path
2. Fetch all `tag_operations` ordered by commit timestamp
3. Apply operations to folder tag set → final tags
4. Delete + reinsert `artifact_tags` rows

This runs on every commit that touches the artifact, ensuring tags stay current.

---

## MCP Tools (`Tools.ts`)

5 read-only tools, all annotated with `readOnlyHint: true, destructiveHint: false`.

| Tool | Input params | Query Pattern |
|---|---|---|
| `kiste_list_artifacts` | `tags?`, `include_deleted?`, `limit?`, `offset?` | Tag filter (AND logic) + alive filter + pagination |
| `kiste_get_artifact` | `path`, `ref?` | Metadata from SQLite + content from `git show` |
| `kiste_search` | `query`, `tags?`, `limit?` | FTS5 MATCH on commit messages, optional tag filter |
| `kiste_get_provenance` | `path` | All commits for an artifact, chronological order |
| `kiste_list_tags` | *(none)* | Distinct tags with counts, alive artifacts only |

Tools only accept semantic parameters — no infrastructure paths like `db_path` or `repo_dir`. These are resolved once at server startup.

`makeTools(run, repoDir)` takes a pre-built effect runner (provided by `Mcp.ts`) and closes over `repoDir` for `git show` calls. Tool registration uses `tool-registry.ts` (same pattern as `@varp/core`).

### Two-Tier Retrieval

- **Structured**: `list_artifacts` with tag filters for known intent
- **Exploratory**: `search` with FTS5 for "I know what I want but not what it's called"

---

## CLI (`Cli.ts`)

`@effect/cli` with `BunRuntime.runMain`. 4 subcommands:

| Command | Layers | Purpose |
|---|---|---|
| `kiste init` | None | Create `.kiste.yaml` + `.kiste/` directory |
| `kiste index [--rebuild]` | Config + Db + Git | Incremental or full reindex |
| `kiste status` | Config + Db + Git | Print commit/artifact/tag counts |
| `kiste query --tags <t>` | Config + Db + Git | List artifacts matching tags (AND) |

Layers are provided per-command handler (not at root level) to avoid opening SQLite during `--help` or `init`.

---

## Testing

30 tests across 4 files, all concurrent-safe.

| File | Tests | Strategy |
|---|---|---|
| `Config.test.ts` | 3 | Schema decode + layer with missing file |
| `Tags.test.ts` | 18 | Pure function unit tests (no IO) |
| `Indexer.test.ts` | 4 | Temp git repos with real commits, verify SQLite state |
| `Tools.test.ts` | 5 | `InMemoryTransport` + MCP `Client`, pre-seeded DB |

Integration tests use `mkdtempSync` for isolation and `rmSync` for cleanup. Git repos are initialized with `Bun.spawnSync`.

---

## Dependencies

| Package | Purpose |
|---|---|
| `effect` | Core: `Effect`, `Layer`, `Context`, `Data`, `Schema` |
| `@effect/platform` | Platform types (required by @effect/platform-bun) |
| `@effect/platform-bun` | `BunContext.layer`, `BunRuntime.runMain` |
| `@effect/sql` | `SqlClient` service tag, SQL abstractions |
| `@effect/sql-sqlite-bun` | `SqliteClient.layer` — SQLite via bun:sqlite |
| `@effect/cli` | `Command.make`, `Options`, CLI framework |
| `@modelcontextprotocol/sdk` | `McpServer`, transports, MCP types |
| `zod` | MCP tool input schemas (SDK requirement) |
