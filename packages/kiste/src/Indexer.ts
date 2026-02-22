import { Effect } from "effect";
import * as SqlClient from "@effect/sql/SqlClient";
import { Config } from "./Config.js";
import { getLastIndexedSha, setLastIndexedSha } from "./Db.js";
import { DbError, IndexError } from "./Errors.js";
import { Git, type RawCommit } from "./Git.js";
import {
  applyTagOperations,
  deriveTagsFromPath,
  parseConventionalCommit,
  parseTagLine,
  type TagOp,
} from "./Tags.js";

// ---------------------------------------------------------------------------
// IndexResult
// ---------------------------------------------------------------------------

export interface IndexResult {
  readonly commits_indexed: number;
  readonly artifacts_indexed: number;
  readonly artifacts_deleted: number;
}

// ---------------------------------------------------------------------------
// rebuildIndex — full reindex from all commits
// ---------------------------------------------------------------------------

export const rebuildIndex = (
  cwd: string,
): Effect.Effect<IndexResult, IndexError | DbError, Git | Config | SqlClient.SqlClient> =>
  Effect.gen(function* () {
    const git = yield* Git;
    const commits = yield* git.log(cwd).pipe(Effect.mapError(toIndexError));
    const result = yield* processCommits(commits);
    if (commits.length > 0) {
      yield* setLastIndexedSha(commits[commits.length - 1]!.sha);
    }
    return result;
  });

// ---------------------------------------------------------------------------
// incrementalIndex — only new commits since last indexed SHA
// ---------------------------------------------------------------------------

export const incrementalIndex = (
  cwd: string,
): Effect.Effect<IndexResult, IndexError | DbError, Git | Config | SqlClient.SqlClient> =>
  Effect.gen(function* () {
    const git = yield* Git;
    const lastSha = yield* getLastIndexedSha;
    const commits = lastSha
      ? yield* git.log(cwd, lastSha).pipe(Effect.mapError(toIndexError))
      : yield* git.log(cwd).pipe(Effect.mapError(toIndexError));

    const result = yield* processCommits(commits);
    if (commits.length > 0) {
      yield* setLastIndexedSha(commits[commits.length - 1]!.sha);
    }
    return result;
  });

// ---------------------------------------------------------------------------
// Internal: processCommits
// ---------------------------------------------------------------------------

const processCommits = (
  commits: readonly RawCommit[],
): Effect.Effect<IndexResult, IndexError | DbError, Config | SqlClient.SqlClient> =>
  Effect.gen(function* () {
    let artifacts_indexed = 0;
    let artifacts_deleted = 0;

    for (const commit of commits) {
      const counts = yield* indexCommit(commit);
      artifacts_indexed += counts.indexed;
      artifacts_deleted += counts.deleted;
    }

    return {
      commits_indexed: commits.length,
      artifacts_indexed,
      artifacts_deleted,
    } satisfies IndexResult;
  });

// ---------------------------------------------------------------------------
// Internal: indexCommit
// ---------------------------------------------------------------------------

const indexCommit = (
  commit: RawCommit,
): Effect.Effect<
  { indexed: number; deleted: number },
  IndexError | DbError,
  Config | SqlClient.SqlClient
> =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const config = yield* Config;

    const conv = parseConventionalCommit(commit.subject);
    const tagOps = parseTagLine(commit.body);

    // Insert commit
    yield* sql
      .unsafe(
        `INSERT OR IGNORE INTO commits (sha, message, author, timestamp, conv_type, conv_scope) VALUES (?, ?, ?, ?, ?, ?)`,
        [commit.sha, commit.subject, commit.author, commit.timestamp, conv?.type ?? null, conv?.scope ?? null],
      )
      .pipe(Effect.catchAll((e) => Effect.fail(new DbError({ message: e.message, cause: e }))));

    // Track affected artifact IDs for tag materialization
    const affectedArtifactIds = new Set<number>();

    // Process added/modified files
    for (const filePath of commit.files) {
      // Upsert artifact
      yield* sql
        .unsafe(`INSERT OR IGNORE INTO artifacts (path, alive) VALUES (?, 1)`, [filePath])
        .pipe(Effect.catchAll((e) => Effect.fail(new DbError({ message: e.message, cause: e }))));
      yield* sql
        .unsafe(`UPDATE artifacts SET alive = 1 WHERE path = ?`, [filePath])
        .pipe(Effect.catchAll((e) => Effect.fail(new DbError({ message: e.message, cause: e }))));

      const artifactRows = yield* sql<{ id: number }>`SELECT id FROM artifacts WHERE path = ${filePath}`.pipe(
        Effect.catchAll((e) => Effect.fail(new DbError({ message: e.message, cause: e }))),
      );
      if (artifactRows.length === 0) continue;
      const artifactId = artifactRows[0].id;
      affectedArtifactIds.add(artifactId);

      // Insert artifact_commits link
      yield* sql
        .unsafe(`INSERT OR IGNORE INTO artifact_commits (artifact_id, commit_sha) VALUES (?, ?)`, [
          artifactId,
          commit.sha,
        ])
        .pipe(Effect.catchAll((e) => Effect.fail(new DbError({ message: e.message, cause: e }))));

      // Insert tag operations if present
      if (tagOps) {
        yield* insertTagOps(sql, artifactId, commit.sha, tagOps);
      }
    }

    // Process deleted files
    for (const filePath of commit.deletedFiles) {
      // Ensure artifact exists
      yield* sql
        .unsafe(`INSERT OR IGNORE INTO artifacts (path, alive) VALUES (?, 0)`, [filePath])
        .pipe(Effect.catchAll((e) => Effect.fail(new DbError({ message: e.message, cause: e }))));
      yield* sql
        .unsafe(`UPDATE artifacts SET alive = 0 WHERE path = ?`, [filePath])
        .pipe(Effect.catchAll((e) => Effect.fail(new DbError({ message: e.message, cause: e }))));

      const artifactRows = yield* sql<{ id: number }>`SELECT id FROM artifacts WHERE path = ${filePath}`.pipe(
        Effect.catchAll((e) => Effect.fail(new DbError({ message: e.message, cause: e }))),
      );
      if (artifactRows.length === 0) continue;
      const artifactId = artifactRows[0].id;
      affectedArtifactIds.add(artifactId);

      yield* sql
        .unsafe(`INSERT OR IGNORE INTO artifact_commits (artifact_id, commit_sha) VALUES (?, ?)`, [
          artifactId,
          commit.sha,
        ])
        .pipe(Effect.catchAll((e) => Effect.fail(new DbError({ message: e.message, cause: e }))));
    }

    // Materialize tags for all affected artifacts
    for (const artifactId of affectedArtifactIds) {
      yield* materializeTags(sql, artifactId, config);
    }

    return {
      indexed: commit.files.length,
      deleted: commit.deletedFiles.length,
    };
  });

// ---------------------------------------------------------------------------
// Internal: insertTagOps
// ---------------------------------------------------------------------------

const insertTagOps = (
  sql: SqlClient.SqlClient,
  artifactId: number,
  commitSha: string,
  ops: readonly TagOp[],
): Effect.Effect<void, DbError> =>
  Effect.forEach(
    ops,
    (op) =>
      sql
        .unsafe(`INSERT INTO tag_operations (artifact_id, commit_sha, tag, op) VALUES (?, ?, ?, ?)`, [
          artifactId,
          commitSha,
          op.tag,
          op.op,
        ])
        .pipe(Effect.catchAll((e) => Effect.fail(new DbError({ message: e.message, cause: e })))),
    { discard: true },
  );

// ---------------------------------------------------------------------------
// Internal: materializeTags
// ---------------------------------------------------------------------------

const materializeTags = (
  sql: SqlClient.SqlClient,
  artifactId: number,
  config: { strip_prefixes: readonly string[]; stop_tags: readonly string[] },
): Effect.Effect<void, DbError> =>
  Effect.gen(function* () {
    // Get artifact path
    const pathRows = yield* sql<{ path: string }>`SELECT path FROM artifacts WHERE id = ${artifactId}`.pipe(
      Effect.catchAll((e) => Effect.fail(new DbError({ message: e.message, cause: e }))),
    );
    if (pathRows.length === 0) return;
    const artifactPath = pathRows[0].path;

    // 1. Folder-derived tags
    const folderTags = new Set(deriveTagsFromPath(artifactPath, config));

    // 2. Get all tag_operations for this artifact, ordered by commit timestamp
    const ops = yield* sql<{ tag: string; op: string }>`
      SELECT to2.tag, to2.op FROM tag_operations to2
      JOIN commits c ON c.sha = to2.commit_sha
      WHERE to2.artifact_id = ${artifactId}
      ORDER BY c.timestamp ASC, to2.id ASC
    `.pipe(Effect.catchAll((e) => Effect.fail(new DbError({ message: e.message, cause: e }))));

    // 3. Apply operations
    const finalTags = applyTagOperations(
      folderTags,
      ops.map((o) => ({ tag: o.tag, op: o.op as "add" | "remove" })),
    );

    // 4. Rewrite artifact_tags
    yield* sql
      .unsafe(`DELETE FROM artifact_tags WHERE artifact_id = ?`, [artifactId])
      .pipe(Effect.catchAll((e) => Effect.fail(new DbError({ message: e.message, cause: e }))));

    yield* Effect.forEach(
      [...finalTags],
      (tag) =>
        sql
          .unsafe(`INSERT INTO artifact_tags (artifact_id, tag) VALUES (?, ?)`, [artifactId, tag])
          .pipe(Effect.catchAll((e) => Effect.fail(new DbError({ message: e.message, cause: e })))),
      { discard: true },
    );
  });

// ---------------------------------------------------------------------------
// Internal: error mapping
// ---------------------------------------------------------------------------

function toIndexError(e: unknown): IndexError {
  return new IndexError({
    message: e instanceof Error ? e.message : String(e),
    cause: e,
  });
}
