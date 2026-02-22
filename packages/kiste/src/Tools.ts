import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import * as SqlClient from "@effect/sql/SqlClient";
import { Effect, Layer } from "effect";
import { z } from "zod";

import { ConfigLive } from "./Config.js";
import { DbLive, initSchema } from "./Db.js";
import { Git, GitLive } from "./Git.js";
import type { ToolDef } from "./tool-registry.js";

// ── Annotations ──

const READ_ONLY: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

// ── Layer + runner ──

const makeLayer = (db_path: string, repo_dir: string) =>
  Layer.mergeAll(ConfigLive(repo_dir), DbLive(db_path), GitLive);

const runEffect = <A>(effect: Effect.Effect<A, unknown, Git | SqlClient.SqlClient>, db_path: string, repo_dir?: string) =>
  Effect.runPromise(effect.pipe(Effect.provide(makeLayer(db_path, repo_dir ?? process.cwd()))));

// ── Common input params ──

const dbPathParam = z.string().describe("Path to kiste SQLite database");
const repoDirParam = z.string().optional().describe("Repository root directory (defaults to cwd)");

// ── Tools ──

export const tools: ToolDef[] = [
  {
    name: "kiste_list_artifacts",
    description:
      "List indexed artifacts with optional tag filter. Returns paths, alive status, and tags.",
    annotations: READ_ONLY,
    inputSchema: {
      db_path: dbPathParam,
      repo_dir: repoDirParam,
      tags: z.array(z.string()).optional().describe("Filter to artifacts having ALL of these tags"),
      include_deleted: z.boolean().optional().describe("Include deleted (alive=0) artifacts (default false)"),
      limit: z.number().optional().describe("Max results (default 100)"),
      offset: z.number().optional().describe("Skip first N results (default 0)"),
    },
    handler: async ({ db_path, repo_dir, tags, include_deleted, limit, offset }) => {
      return runEffect(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* initSchema;

          const lim = limit ?? 100;
          const off = offset ?? 0;
          const alive = include_deleted ? "" : "AND a.alive = 1";

          if (tags && tags.length > 0) {
            const placeholders = tags.map(() => "?").join(", ");
            const rows = yield* sql.unsafe(
              `SELECT a.id, a.path, a.alive,
                      GROUP_CONCAT(at2.tag) as tags
               FROM artifacts a
               JOIN artifact_tags at2 ON at2.artifact_id = a.id
               WHERE at2.tag IN (${placeholders}) ${alive}
               GROUP BY a.id
               HAVING COUNT(DISTINCT at2.tag) = ?
               ORDER BY a.path
               LIMIT ? OFFSET ?`,
              [...tags, tags.length, lim, off],
            );
            return { artifacts: rows, count: rows.length };
          }

          const rows = yield* sql.unsafe(
            `SELECT a.id, a.path, a.alive,
                    (SELECT GROUP_CONCAT(at2.tag) FROM artifact_tags at2 WHERE at2.artifact_id = a.id) as tags
             FROM artifacts a
             WHERE 1=1 ${alive}
             ORDER BY a.path
             LIMIT ? OFFSET ?`,
            [lim, off],
          );
          return { artifacts: rows, count: rows.length };
        }),
        db_path,
        repo_dir,
      );
    },
  },

  {
    name: "kiste_get_artifact",
    description:
      "Get artifact details: file content (from git), tags, and associated commits.",
    annotations: READ_ONLY,
    inputSchema: {
      db_path: dbPathParam,
      repo_dir: repoDirParam,
      path: z.string().describe("File path relative to repo root"),
      ref: z.string().optional().describe("Git ref to read content from (default HEAD)"),
    },
    handler: async ({ db_path, repo_dir, path, ref }) => {
      const repoRoot = repo_dir ?? process.cwd();
      return runEffect(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          const git = yield* Git;
          yield* initSchema;

          // Get artifact from DB
          const artifactRows = yield* sql.unsafe(
            `SELECT id, path, alive FROM artifacts WHERE path = ?`,
            [path],
          );
          if (artifactRows.length === 0) {
            return { error: `Artifact not found: ${path}` };
          }
          const artifact = artifactRows[0];

          // Get tags
          const tagRows = yield* sql.unsafe(
            `SELECT tag FROM artifact_tags WHERE artifact_id = ?`,
            [artifact.id],
          );
          const tags = tagRows.map((r: { tag: string }) => r.tag);

          // Get commits
          const commitRows = yield* sql.unsafe(
            `SELECT c.sha, c.message, c.author, c.timestamp
             FROM commits c
             JOIN artifact_commits ac ON ac.commit_sha = c.sha
             WHERE ac.artifact_id = ?
             ORDER BY c.timestamp DESC`,
            [artifact.id],
          );

          // Read content from git
          const gitRef = ref ?? "HEAD";
          const content = yield* git.show(repoRoot, gitRef, path).pipe(
            Effect.catchAll(() => Effect.succeed(null)),
          );

          return {
            path: artifact.path,
            alive: artifact.alive === 1,
            tags,
            commits: commitRows,
            content,
          };
        }),
        db_path,
        repo_dir,
      );
    },
  },

  {
    name: "kiste_search",
    description:
      "Full-text search over commit messages using FTS5. Optionally filter by artifact tags.",
    annotations: READ_ONLY,
    inputSchema: {
      db_path: dbPathParam,
      repo_dir: repoDirParam,
      query: z.string().describe("FTS5 search query over commit messages"),
      tags: z.array(z.string()).optional().describe("Filter to commits touching artifacts with these tags"),
      limit: z.number().optional().describe("Max results (default 20)"),
    },
    handler: async ({ db_path, repo_dir, query, tags, limit }) => {
      return runEffect(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* initSchema;

          const lim = limit ?? 20;

          if (tags && tags.length > 0) {
            const placeholders = tags.map(() => "?").join(", ");
            const rows = yield* sql.unsafe(
              `SELECT DISTINCT c.sha, c.message, c.author, c.timestamp,
                      c.conv_type, c.conv_scope
               FROM commits_fts fts
               JOIN commits c ON c.rowid = fts.rowid
               JOIN artifact_commits ac ON ac.commit_sha = c.sha
               JOIN artifact_tags at2 ON at2.artifact_id = ac.artifact_id
               WHERE commits_fts MATCH ? AND at2.tag IN (${placeholders})
               ORDER BY c.timestamp DESC
               LIMIT ?`,
              [query, ...tags, lim],
            );
            return { results: rows, count: rows.length };
          }

          const rows = yield* sql.unsafe(
            `SELECT c.sha, c.message, c.author, c.timestamp,
                    c.conv_type, c.conv_scope
             FROM commits_fts fts
             JOIN commits c ON c.rowid = fts.rowid
             WHERE commits_fts MATCH ?
             ORDER BY c.timestamp DESC
             LIMIT ?`,
            [query, lim],
          );
          return { results: rows, count: rows.length };
        }),
        db_path,
        repo_dir,
      );
    },
  },

  {
    name: "kiste_get_provenance",
    description:
      "Full commit history for a file path. Returns all commits that touched this artifact, ordered chronologically.",
    annotations: READ_ONLY,
    inputSchema: {
      db_path: dbPathParam,
      repo_dir: repoDirParam,
      path: z.string().describe("File path relative to repo root"),
    },
    handler: async ({ db_path, repo_dir, path }) => {
      return runEffect(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* initSchema;

          const rows = yield* sql.unsafe(
            `SELECT c.sha, c.message, c.author, c.timestamp,
                    c.conv_type, c.conv_scope
             FROM commits c
             JOIN artifact_commits ac ON ac.commit_sha = c.sha
             JOIN artifacts a ON a.id = ac.artifact_id
             WHERE a.path = ?
             ORDER BY c.timestamp ASC`,
            [path],
          );
          return { path, commits: rows, count: rows.length };
        }),
        db_path,
        repo_dir,
      );
    },
  },

  {
    name: "kiste_list_tags",
    description: "List all tags with their artifact counts.",
    annotations: READ_ONLY,
    inputSchema: {
      db_path: dbPathParam,
      repo_dir: repoDirParam,
    },
    handler: async ({ db_path, repo_dir }) => {
      return runEffect(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* initSchema;

          const rows = yield* sql.unsafe(
            `SELECT at2.tag, COUNT(*) as count
             FROM artifact_tags at2
             JOIN artifacts a ON a.id = at2.artifact_id
             WHERE a.alive = 1
             GROUP BY at2.tag
             ORDER BY count DESC, at2.tag ASC`,
          );
          return { tags: rows };
        }),
        db_path,
        repo_dir,
      );
    },
  },
];
