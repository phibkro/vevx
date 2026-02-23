import { resolve } from "node:path";

import { SqliteClient } from "@effect/sql-sqlite-bun";
import * as SqlClient from "@effect/sql/SqlClient";
import { SqlError } from "@effect/sql/SqlError";
import { Effect, Layer } from "effect";
import type { ConfigError } from "effect/ConfigError";

import { Config } from "./Config.js";
import { DbError } from "./Errors.js";

// ---------------------------------------------------------------------------
// Schema DDL
// ---------------------------------------------------------------------------

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS artifacts (
    id INTEGER PRIMARY KEY,
    path TEXT NOT NULL UNIQUE,
    alive INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE TABLE IF NOT EXISTS commits (
    sha TEXT PRIMARY KEY,
    message TEXT NOT NULL,
    author TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    conv_type TEXT,
    conv_scope TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS artifact_commits (
    artifact_id INTEGER REFERENCES artifacts(id),
    commit_sha TEXT REFERENCES commits(sha),
    PRIMARY KEY (artifact_id, commit_sha)
  )`,
  `CREATE TABLE IF NOT EXISTS artifact_tags (
    artifact_id INTEGER REFERENCES artifacts(id),
    tag TEXT NOT NULL,
    PRIMARY KEY (artifact_id, tag)
  )`,
  `CREATE TABLE IF NOT EXISTS tag_operations (
    id INTEGER PRIMARY KEY,
    artifact_id INTEGER REFERENCES artifacts(id),
    commit_sha TEXT REFERENCES commits(sha),
    tag TEXT NOT NULL,
    op TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_artifact_commits_sha ON artifact_commits(commit_sha)`,
  `CREATE VIRTUAL TABLE IF NOT EXISTS commits_fts USING fts5(
    message, content=commits, content_rowid=rowid
  )`,
  // AFTER INSERT only — not AFTER INSERT OR REPLACE. Commits use INSERT OR IGNORE,
  // so the trigger won't fire on ignored rows (correct). If the DDL ever changes to
  // INSERT OR REPLACE, duplicate FTS entries would accumulate silently.
  `CREATE TRIGGER IF NOT EXISTS commits_fts_insert AFTER INSERT ON commits
   BEGIN INSERT INTO commits_fts(rowid, message) VALUES (new.rowid, new.message); END`,
];

// ---------------------------------------------------------------------------
// Schema init
// ---------------------------------------------------------------------------

export const initSchema: Effect.Effect<void, DbError, SqlClient.SqlClient> = Effect.gen(
  function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* Effect.forEach(
      SCHEMA_STATEMENTS,
      (ddl) => sql.unsafe(ddl).pipe(Effect.catchAll((e) => Effect.fail(toDbError(e)))),
      { discard: true },
    );
  },
);

// ---------------------------------------------------------------------------
// Meta helpers
// ---------------------------------------------------------------------------

const META_KEY_LAST_SHA = "last_indexed_sha";

export const getLastIndexedSha: Effect.Effect<string | null, DbError, SqlClient.SqlClient> =
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const rows = yield* sql<{
      value: string;
    }>`SELECT value FROM meta WHERE key = ${META_KEY_LAST_SHA}`.pipe(
      Effect.catchAll((e) => Effect.fail(toDbError(e))),
    );
    return rows.length > 0 ? rows[0].value : null;
  });

export const setLastIndexedSha = (sha: string): Effect.Effect<void, DbError, SqlClient.SqlClient> =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql
      .unsafe(`INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)`, [META_KEY_LAST_SHA, sha])
      .pipe(Effect.catchAll((e) => Effect.fail(toDbError(e))));
  });

// ---------------------------------------------------------------------------
// Snapshot meta helpers
// ---------------------------------------------------------------------------

const META_KEY_SNAPSHOT_SHA = "snapshot_sha";
const META_KEY_SNAPSHOT_PATH = "snapshot_path";

export const getSnapshotMeta: Effect.Effect<
  { sha: string; path: string } | null,
  DbError,
  SqlClient.SqlClient
> = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{
    key: string;
    value: string;
  }>`SELECT key, value FROM meta WHERE key IN (${META_KEY_SNAPSHOT_SHA}, ${META_KEY_SNAPSHOT_PATH})`.pipe(
    Effect.catchAll((e) => Effect.fail(toDbError(e))),
  );
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const sha = map.get(META_KEY_SNAPSHOT_SHA);
  const path = map.get(META_KEY_SNAPSHOT_PATH);
  if (!sha || !path) return null;
  return { sha, path };
});

export const setSnapshotMeta = (
  sha: string,
  path: string,
): Effect.Effect<void, DbError, SqlClient.SqlClient> =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql
      .unsafe(`INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)`, [
        META_KEY_SNAPSHOT_SHA,
        sha,
      ])
      .pipe(Effect.catchAll((e) => Effect.fail(toDbError(e))));
    yield* sql
      .unsafe(`INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)`, [
        META_KEY_SNAPSHOT_PATH,
        path,
      ])
      .pipe(Effect.catchAll((e) => Effect.fail(toDbError(e))));
  });

// ---------------------------------------------------------------------------
// Layer factory
// ---------------------------------------------------------------------------

export const DbLive = (
  dbPath: string,
): Layer.Layer<SqliteClient.SqliteClient | SqlClient.SqlClient, ConfigError> =>
  SqliteClient.layer({ filename: dbPath });

/**
 * Construct a DB layer that reads db_path from Config.
 * Requires Config to be provided in the layer composition.
 */
export const DbFromConfig = (
  cwd: string,
): Layer.Layer<SqliteClient.SqliteClient | SqlClient.SqlClient, ConfigError, Config> =>
  Layer.unwrapEffect(
    Effect.gen(function* () {
      const config = yield* Config;
      const dbPath = resolve(cwd, config.db_path);
      return SqliteClient.layer({ filename: dbPath });
    }),
  );

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

function toDbError(e: SqlError): DbError {
  return new DbError({ message: e.message, cause: e });
}
