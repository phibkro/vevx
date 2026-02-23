# kiste
## design document — v0.4

> For implementation details (service graph, error types, data model), see [architecture.md](architecture.md).

---

## 1. problem statement

### 1.1 the filesystem mismatch

the filesystem was designed for humans who mentally maintain a hierarchy of paths. agents don't think in paths — they think in terms of what they need, not where it lives. the path `/src/auth/session/handler.ts` is meaningful to a human who remembers creating it. to an agent starting a new session with no persistent memory, it's an arbitrary string.

the core mismatches:

- **locality is wrong** — the filesystem organizes by type and domain (`logs/`, `config/`, `output/`) rather than by task or concern. agents working on a task need everything relevant to that task, regardless of where it lives.
- **no semantic retrieval** — you can't ask a filesystem "give me everything related to the auth refactor." you need a layer on top — which is why every serious agent framework ends up bolting on a vector database as an afterthought.
- **mutation is lossy** — overwriting a file destroys the trajectory. agents benefit from knowing *how* something got to its current state, not just what it currently is.
- **no provenance** — files don't record what produced them, what decisions led to them, or what depends on them.

### 1.2 what agents actually need

instead of "write to path / read from path," agents benefit from: store artifact with metadata, retrieve artifacts by relevance, query the causal chain that produced something, list what's available without loading everything into context.

the unit of storage for agents isn't a file — it's an **artifact**: something with provenance (what produced it), relationships (what depends on it), and semantic content (retrievable by meaning).

### 1.3 the insight

every software project already has a git history. git is a content-addressable, append-only, immutable store with built-in provenance — exactly what agents need. the filesystem is already the source of truth. the missing piece is a semantic index layer on top of git that exposes an agent-friendly query interface, without replacing or competing with the filesystem.

distribution follows naturally: install the tool on any existing repo, get semantic retrieval over your entire project history from day one. zero migration, zero lock-in. the sqlite index is derived and reconstructable — uninstall and nothing changed about your repo.

---

## 2. commit convention

kiste extracts signal from whatever git history exists. the richer the commits, the richer the index. this is a gradient, not a requirement.

### 2.1 extended conventional commits

kiste builds on [conventional commits](https://www.conventionalcommits.org/). the subject line follows the standard format. the body is free prose — the implicit "why" that git commit messages have always been for. the structured extension is a single `tags:` line at the end of the body:

```
feat(auth): add rate limiting

Added per-user rate limiting using Redis sliding window. Threshold
is configurable per endpoint, defaults to 100 req/min.

tags: auth, rate-limiting, redis
```

the `tags:` line is optional. commits without it get folder-derived tags as fallback (see §3.2). commits with it get explicit tags that override and extend the inferred ones.

### 2.2 tag syntax

tags support add and remove operations, enabling tag state to evolve cleanly as a codebase changes:

```
tags: +session, -auth, redis
```

- `+tag` — explicit add (same as bare tag)
- `-tag` — remove a tag previously applied to this artifact
- `tag` — bare form, equivalent to `+tag`

kiste replays tag operations in commit order to compute current tag state per artifact. removing a tag that was never added is a no-op.

### 2.3 varp integration

when varp commits on behalf of an agent, it infers tags from two sources:

1. **manifest component matching** — files are matched against `varp.yaml` component paths. a file in `packages/core/src/manifest/` gets `tags: core, manifest` from the component hierarchy.
2. **plan metadata** — if the commit is part of a varp plan execution, task-level tags from the plan are included.

humans can override or extend with explicit `tags:` lines. non-varp commits get folder-derived tags as fallback.

varp is not required. it's an enhancement to the signal, not a prerequisite.

---

## 3. architecture

kiste is a CQRS system at local scale: git is the write log and source of truth, sqlite is the derived read model, and an MCP server exposes a read-only query interface to agents.

```
  git history
      │
      ▼
  indexer (effect-ts/bun)
      │ parses commits, extracts tags, updates index
      ▼
  sqlite (derived read model)
      │ metadata + tags + FTS index (no file content)
      ▼
  MCP server (read-only)
      │
      ▼
  agents
```

the index is always reconstructable from git. if it drifts or corrupts, reindex from scratch. sqlite is never the source of truth.

**one index per repo root.** kiste creates a single index for the entire git repository, not per-component or per-workspace. this is deliberate — cross-component co-change data is the most valuable signal for agents, and splitting indexes would lose it.

### 3.1 git layer

standard git repo. no new file types, no sidecars, no parallel metadata. all signal lives in commit history — commit messages, file paths, authorship, timestamps. the extended commit convention (§2) is the only addition, and it's optional.

agents can commit directly. varp wraps git with structured commit conventions when available, but the indexer handles any commit from any source.

**indexing trigger:** post-commit hook for interactive use (immediate index after each commit). CI pipelines run `kiste index` as a build step. no daemon or polling required.

### 3.2 index layer

a single sqlite database. the index stores **metadata only** — no file content. content is read from git/filesystem on demand at query time. this keeps the index small and avoids duplicating what git already stores.

schema:

```sql
-- one row per file path ever seen in the repo
CREATE TABLE artifacts (
  id          INTEGER PRIMARY KEY,
  path        TEXT NOT NULL UNIQUE,
  alive       INTEGER NOT NULL DEFAULT 1  -- 0 if deleted in latest commit
);

-- one row per commit
CREATE TABLE commits (
  sha         TEXT PRIMARY KEY,
  message     TEXT NOT NULL,
  author      TEXT NOT NULL,
  timestamp   INTEGER NOT NULL,        -- unix epoch
  conv_type   TEXT,                    -- feat, fix, refactor, etc. (nullable)
  conv_scope  TEXT                     -- scope from conventional commit (nullable)
);

-- which artifacts changed in which commits (join direction: artifact→commits)
-- "given an artifact, find all commits that touched it" is the primary query path.
-- the reverse query ("given a commit, find all artifacts it touched") is also
-- supported but less common in the MCP interface.
CREATE TABLE artifact_commits (
  artifact_id INTEGER REFERENCES artifacts(id),
  commit_sha  TEXT REFERENCES commits(sha),
  PRIMARY KEY (artifact_id, commit_sha)
);

-- current tag state per artifact (materialized from tag operations)
CREATE TABLE artifact_tags (
  artifact_id INTEGER REFERENCES artifacts(id),
  tag         TEXT NOT NULL,
  PRIMARY KEY (artifact_id, tag)
);

-- full tag operation history for rebuild
CREATE TABLE tag_operations (
  id          INTEGER PRIMARY KEY,
  artifact_id INTEGER REFERENCES artifacts(id),
  commit_sha  TEXT REFERENCES commits(sha),
  tag         TEXT NOT NULL,
  op          TEXT NOT NULL            -- 'add' or 'remove'
);

-- FTS index over commit messages for full-text search
CREATE VIRTUAL TABLE commits_fts USING fts5(message, content=commits, content_rowid=rowid);
```

**folder-derived tags** — an artifact at `auth/session/handler.ts` gets tags derived from its path segments. a configurable `strip_prefixes` list (default: `['src', 'lib', 'components', 'app', 'pages']`) removes noise segments. so `src/auth/session/handler.ts` → `['auth', 'session']`, not `['src', 'auth', 'session']`. a `stop_tags` list filters out overly generic segments.

**deletion tracking** — the `alive` flag on artifacts tracks whether a file exists in the current HEAD. `list_artifacts` filters to alive artifacts by default, with an `include_deleted` option.

**snapshots** — replaying all commits from scratch gets expensive as history grows. periodic snapshots store a serialized sqlite dump at a tagged git commit. indexing becomes: restore latest snapshot, apply commits since that point. snapshots are a performance optimization only — the source of truth is always git.

### 3.3 indexer

an effect-ts/bun process that reads git history (via `Bun.spawnSync` + git CLI) and updates sqlite (via `@effect/sql-sqlite-bun`).

responsibilities:
- parse structured commit messages → populate `commits` and `tag_operations` tables
- extract folder-path tags from artifact paths (with prefix stripping)
- materialize current tag state in `artifact_tags`
- track file deletion status from diffs
- maintain idempotency — replaying all commits produces the same index as incremental updates
- write snapshots periodically or on-demand

the indexer is stateless between runs. no daemon required beyond a git hook or lightweight watcher.

### 3.4 MCP server

a read-only, stateless MCP server. tools operate over sqlite for metadata and git for content. progressive disclosure: list operations return lightweight summaries, get operations return full content on demand.

**tools:**

`list_artifacts(tags?, include_deleted?, include_ignored?, source_only?, limit?, offset?)` → `{path, tags, last_modified}[]`
list artifacts, optionally filtered by tags. returns summaries only — no content. defaults to alive, non-gitignored artifacts. `source_only` restricts to files under `src/` directories. offset-based pagination.

`get_artifact(path, ref?)` → `{path, content, tags, commits[]}`
full artifact content (read from git at `ref`, default HEAD) plus commit history and current tags.

`search(query, tags?, limit?)` → `{path, tags, score}[]`
full-text search over commit messages and artifact paths. tag filter applied before search. returns paths and scores, not content — caller fetches what it needs.

`get_provenance(path)` → `{commit, message, author, timestamp, tags_at_commit}[]`
full commit history for an artifact, oldest first. shows how tags evolved over time.

`list_tags()` → `{tag, count}[]`
all tags in the index with artifact counts. useful for exploration.

`get_cochange(path, limit?)` → `{path, count, jaccard}[]` *(phase 2)*
given an artifact, find other artifacts that frequently change in the same commits. returns co-change pairs ranked by frequency. this is behavioral coupling — the most valuable cross-component signal for agents.

two-tier retrieval: structured tag queries for known intent, full-text search as fallback for exploration. agents use tags most of the time; full-text search handles "i know what i'm looking for but not what it's called."

---

## 4. tech stack

| concern | choice | rationale |
|---|---|---|
| core | effect-ts/bun | effect provides typed errors, services/layers for DI, and composable pipelines. bun for runtime. |
| git integration | git CLI via `Bun.spawnSync` | no native dependency overhead. git is always installed. sufficient for batch indexing. |
| sqlite | @effect/sql-sqlite-bun | effect-native SQL with typed errors. thin wrapper over bun:sqlite. |
| full-text search | sqlite FTS5 | built into sqlite. handles commit message and path search without external deps. |
| MCP server | @modelcontextprotocol/sdk | same SDK used by @varp/core. proven in this monorepo. |
| config | `.kiste.yaml` | consistent with varp's yaml-first approach. parsed with `Bun.YAML`. |
| schemas | effect/Schema + Zod | effect/Schema for domain types. Zod for MCP tool inputs (SDK requirement). |

**why not rust?** the indexer's bottleneck is git history traversal, which is I/O bound regardless of language. bun:sqlite is a thin wrapper over native sqlite. typescript keeps the entire monorepo in one toolchain, simplifies CI, and lets the indexer share types/utilities with @varp/core.

**embeddings deferred.** tag-based retrieval + FTS5 covers the majority of agent query patterns. semantic search (sqlite-vec + local embeddings) is a future phase, added only if agents demonstrably hit a retrieval wall that tags + FTS can't solve.

---

## 5. configuration

`.kiste.yaml` in the repo root:

```yaml
# path segments to strip when deriving tags (default shown)
strip_prefixes:
  - src
  - lib
  - components
  - app
  - pages

# tags to never generate from path segments
stop_tags:
  - index
  - utils
  - helpers
  - types

# auto-snapshot every N indexed commits (0 = disabled)
snapshot_frequency: 500

# paths to exclude from indexing (gitignore-style globs)
exclude:
  - "node_modules/**"
  - "dist/**"
  - "*.lock"
```

all fields are optional with sensible defaults. missing config file = all defaults.

---

## 6. roadmap

### phase 0 — foundation ✅
- package scaffolding: `packages/kiste/` as bun workspace with effect-ts
- git history reading via `Bun.spawnSync` + git CLI
- sqlite schema via `@effect/sql-sqlite-bun`
- basic indexer: commits → sqlite (metadata only, no content storage)
- folder-derived tag extraction with configurable prefix stripping
- tag operation parsing and replay from commit bodies
- `.kiste.yaml` config parsing via effect/Schema
- cli: `kiste init`, `kiste index`, `kiste status`, `kiste query`

**done when:** `kiste index` on an existing repo produces a queryable sqlite database reflecting the commit history. folder-derived tags are correct with prefix stripping. deletion tracking works. idempotent reindex produces identical results. ✅

### phase 1 — read interface ✅
- FTS5 index over commit messages
- MCP server: `list_artifacts`, `get_artifact`, `get_provenance`, `list_tags`, `search`
- content retrieval from git on demand (not stored in sqlite)
- progressive disclosure: summaries vs full content
- `kiste query --tags auth` works from cli

**done when:** an agent can list artifacts by tag, search commit messages, and retrieve full content + provenance for any artifact. content is read from git, not sqlite. validated on a real repo. ✅

### phase 2 — co-change and extended commits
- `get_cochange(path, limit?)` MCP tool — behavioral coupling from `artifact_commits` join
- snapshot/checkpoint implementation (auto-trigger + on-demand)
- ~~post-commit hook for automatic incremental indexing~~ ✅ done (plugin hook in `hooks/scripts/post-commit.sh`)
- ~~varp generates `tags:` lines from manifest component matching on agent commits~~ ✅ done (varp's `tag-commits` hook)
- ~~wire `exclude` config to indexer~~ ✅ done
- ~~wire `db_path` config to CLI~~ ✅ done

**done when:** `get_cochange` returns meaningful co-change pairs. explicit tags override folder-derived tags correctly. tag history is replayable. snapshots produce identical results to full reindex.

### phase 3 — varp integration
- varp reads kiste index during planning (`varp_suggest_touches` enriched with co-change data)
- ~~session-start hook surfaces kiste summary alongside graph summary~~ ✅ done (plugin hook in `hooks/scripts/session-start.sh`)
- end-to-end test: multi-agent workflow with kiste providing context

**done when:** varp sessions are demonstrably better with kiste than without.

### phase 4 — semantic retrieval (conditional)
- sqlite-vec integration
- local embedding inference (model TBD — evaluate options at that time)
- async embedding queue (non-blocking on index operations)
- MCP: `search` enhanced with vector similarity

**done when:** semantic search returns relevant results. only pursued if phases 0-3 reveal retrieval gaps that FTS + tags can't cover.

---

## 7. resolved decisions

- **content storage** — content is NOT stored in sqlite. read from git/filesystem on demand. keeps index small, avoids duplication.
- **language** — typescript/bun with effect-ts, not rust. same toolchain as the monorepo. I/O-bound workload doesn't benefit from rust's compute advantages.
- **embeddings** — deferred to phase 4, conditional on demonstrated need. FTS5 + tags first.
- **snapshot frequency** — configurable, default 500 commits. auto-trigger + on-demand via CLI.
- **MCP pagination** — offset-based for `list_artifacts` (phase 0). cursor-based if needed later.
- **rebuild_index** — CLI only. MCP surface stays minimal and read-only.
- **deletion tracking** — `alive` flag on artifacts, filtered by default.
- **indexing trigger** — post-commit hook for interactive use (immediate, zero polling). CI pipelines run `kiste index` as a build step. no daemon.
- **index scope** — one index per repo root, not per component or workspace. cross-component co-change is the most valuable signal and would be lost by splitting.
- **artifact_commits join direction** — primary query path is artifact→commits ("what commits touched this file?"). reverse direction (commit→artifacts) supported but secondary.
- **co-change tool** — `get_cochange(path, limit?)` added to phase 2 roadmap. behavioral coupling from the `artifact_commits` join table is the highest-value signal for agents navigating unfamiliar codebases.
- **tag parsing shipped early** — `parseTagLine` and `applyTagOperations` implemented in phase 0 (ahead of phase 2 schedule) since the code was simple and pure.

---

## 8. open questions

(none at this time — all prior questions resolved in v0.4)

---

## 9. explicitly out of scope

- a new event store (git is the event store)
- distributed storage or multi-machine sync
- conflict resolution beyond what git provides
- replacing the filesystem — additive only
- a write interface on the MCP server
- requiring varp — kiste works on any git repo
- content storage in sqlite — git is the content store
