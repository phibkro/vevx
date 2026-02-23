import * as SqlClient from "@effect/sql/SqlClient";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { Effect } from "effect";
import { z } from "zod";

import { initSchema } from "./Db.js";
import { Git } from "./Git.js";
import type { ToolDef } from "./tool-registry.js";

// ── Annotations ──

const READ_ONLY: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

// ── Gitignore filtering ──

/**
 * Batch-check which paths are gitignored using `git check-ignore --stdin`.
 * Returns the set of ignored paths. Pure filtering — no DB writes.
 */
function getIgnoredPaths(repoDir: string, paths: string[]): Set<string> {
  if (paths.length === 0) return new Set();
  const result = Bun.spawnSync(["git", "check-ignore", "--no-index", "--stdin"], {
    cwd: repoDir,
    stdin: Buffer.from(paths.join("\n")),
    stdout: "pipe",
    stderr: "pipe",
  });
  // git check-ignore exits 1 if no paths are ignored — not an error
  const output = result.stdout.toString().trim();
  if (!output) return new Set();
  return new Set(output.split("\n").map((p) => p.trim()));
}

// ── FTS5 sanitization ──

/**
 * Strip FTS5 special operators/syntax to prevent query injection.
 * Keeps alphanumeric, spaces, hyphens, underscores. Collapses whitespace.
 */
function sanitizeFts5Query(query: string): string {
  return query
    .replace(/[^a-zA-Z0-9\s\-_]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ── Runner type ──

export type RunEffect = <A>(
  effect: Effect.Effect<A, unknown, Git | SqlClient.SqlClient>,
) => Promise<A>;

// ── Tools factory ──

export function makeTools(run: RunEffect, repoDir: string): ToolDef[] {
  return [
    {
      name: "kiste_list_artifacts",
      description:
        "List indexed artifacts with optional tag filter. Returns paths, alive status, and tags. Gitignored files are excluded by default.",
      annotations: READ_ONLY,
      inputSchema: {
        tags: z
          .array(z.string())
          .optional()
          .describe("Filter to artifacts having ALL of these tags"),
        include_deleted: z
          .boolean()
          .optional()
          .describe("Include deleted (alive=0) artifacts (default false)"),
        include_ignored: z
          .boolean()
          .optional()
          .describe("Include gitignored files (default false)"),
        source_only: z
          .boolean()
          .optional()
          .describe("Only include files under src/ directories (default false)"),
        limit: z.number().optional().describe("Max results (default 100)"),
        offset: z.number().optional().describe("Skip first N results (default 0)"),
      },
      handler: async ({ tags, include_deleted, include_ignored, source_only, limit, offset }) => {
        return run(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            yield* initSchema;

            const lim = limit ?? 100;
            const off = offset ?? 0;
            const alive = include_deleted ? "" : "AND a.alive = 1";
            const srcFilter = source_only
              ? "AND (a.path LIKE 'src/%' OR a.path LIKE '%/src/%')"
              : "";

            // Fetch more rows than needed to account for gitignore filtering
            const fetchLimit = include_ignored ? lim : lim * 3;

            type ArtifactRow = { id: number; path: string; alive: number; tags: string };
            let rows: readonly ArtifactRow[];

            if (tags && tags.length > 0) {
              const placeholders = tags.map(() => "?").join(", ");
              rows = (yield* sql.unsafe(
                `SELECT a.id, a.path, a.alive,
                        GROUP_CONCAT(at2.tag) as tags
                 FROM artifacts a
                 JOIN artifact_tags at2 ON at2.artifact_id = a.id
                 WHERE at2.tag IN (${placeholders}) ${alive} ${srcFilter}
                 GROUP BY a.id
                 HAVING COUNT(DISTINCT at2.tag) = ?
                 ORDER BY a.path
                 LIMIT ? OFFSET ?`,
                [...tags, tags.length, fetchLimit, off],
              )) as unknown as ArtifactRow[];
            } else {
              rows = (yield* sql.unsafe(
                `SELECT a.id, a.path, a.alive,
                        (SELECT GROUP_CONCAT(at2.tag) FROM artifact_tags at2 WHERE at2.artifact_id = a.id) as tags
                 FROM artifacts a
                 WHERE 1=1 ${alive} ${srcFilter}
                 ORDER BY a.path
                 LIMIT ? OFFSET ?`,
                [fetchLimit, off],
              )) as unknown as ArtifactRow[];
            }

            // Filter out gitignored paths unless opted in
            let filtered = [...rows];
            if (!include_ignored && filtered.length > 0) {
              const ignored = getIgnoredPaths(
                repoDir,
                filtered.map((r) => r.path),
              );
              if (ignored.size > 0) {
                filtered = filtered.filter((r) => !ignored.has(r.path));
              }
            }

            // Apply the actual limit after filtering
            const result = filtered.slice(0, lim);
            return { artifacts: result, count: result.length };
          }),
        );
      },
    },

    {
      name: "kiste_get_artifact",
      description: "Get artifact details: file content (from git), tags, and associated commits.",
      annotations: READ_ONLY,
      inputSchema: {
        path: z.string().describe("File path relative to repo root"),
        ref: z.string().optional().describe("Git ref to read content from (default HEAD)"),
      },
      handler: async ({ path, ref }) => {
        return run(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            const git = yield* Git;
            yield* initSchema;

            const artifactRows = (yield* sql.unsafe(
              `SELECT id, path, alive FROM artifacts WHERE path = ?`,
              [path],
            )) as unknown as { id: number; path: string; alive: number }[];
            if (artifactRows.length === 0) {
              return { error: `Artifact not found: ${path}` };
            }
            const artifact = artifactRows[0];

            const tagRows = (yield* sql.unsafe(
              `SELECT tag FROM artifact_tags WHERE artifact_id = ?`,
              [artifact.id],
            )) as unknown as { tag: string }[];
            const tags = tagRows.map((r) => r.tag);

            const commitRows = yield* sql.unsafe(
              `SELECT c.sha, c.message, c.author, c.timestamp
               FROM commits c
               JOIN artifact_commits ac ON ac.commit_sha = c.sha
               WHERE ac.artifact_id = ?
               ORDER BY c.timestamp DESC`,
              [artifact.id],
            );

            const gitRef = ref ?? "HEAD";
            const content = yield* git
              .show(repoDir, gitRef, path)
              .pipe(Effect.catchAll(() => Effect.succeed(null)));

            return {
              path: artifact.path,
              alive: artifact.alive === 1,
              tags,
              commits: commitRows,
              content,
            };
          }),
        );
      },
    },

    {
      name: "kiste_search",
      description:
        "Full-text search over commit messages using FTS5. Optionally filter by artifact tags.",
      annotations: READ_ONLY,
      inputSchema: {
        query: z.string().describe("FTS5 search query over commit messages"),
        tags: z
          .array(z.string())
          .optional()
          .describe("Filter to commits touching artifacts with these tags"),
        limit: z.number().optional().describe("Max results (default 20)"),
      },
      handler: async ({ query, tags, limit }) => {
        return run(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            yield* initSchema;

            const lim = limit ?? 20;

            const safeQuery = sanitizeFts5Query(query);
            if (!safeQuery) {
              return { results: [], count: 0 };
            }

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
                [safeQuery, ...tags, lim],
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
              [safeQuery, lim],
            );
            return { results: rows, count: rows.length };
          }),
        );
      },
    },

    {
      name: "kiste_get_provenance",
      description:
        "Full commit history for a file path. Returns all commits that touched this artifact, ordered chronologically.",
      annotations: READ_ONLY,
      inputSchema: {
        path: z.string().describe("File path relative to repo root"),
      },
      handler: async ({ path }) => {
        return run(
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
        );
      },
    },

    {
      name: "kiste_get_cochange",
      description:
        "Returns files that most frequently change alongside the queried file, ranked by co-change weight from git history.",
      annotations: READ_ONLY,
      inputSchema: {
        path: z.string().describe("File path relative to repo root"),
        limit: z.number().optional().describe("Max results (default 20)"),
      },
      handler: async ({ path, limit }) => {
        return run(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            yield* initSchema;

            const lim = limit ?? 20;

            // Check artifact exists
            const artifactRows = (yield* sql.unsafe(`SELECT id FROM artifacts WHERE path = ?`, [
              path,
            ])) as unknown as { id: number }[];
            if (artifactRows.length === 0) {
              return { error: `Artifact not found: ${path}` };
            }

            // Count total commits for this artifact
            const totalRows = (yield* sql.unsafe(
              `SELECT COUNT(*) as count FROM artifact_commits WHERE artifact_id = ?`,
              [artifactRows[0].id],
            )) as unknown as { count: number }[];
            const total_commits = totalRows[0].count;

            // Find co-changing files via self-join on artifact_commits
            const rows = (yield* sql.unsafe(
              `WITH target AS (
                SELECT id FROM artifacts WHERE path = ?
              ),
              target_commits AS (
                SELECT commit_sha FROM artifact_commits WHERE artifact_id = (SELECT id FROM target)
              ),
              cochanges AS (
                SELECT ac.artifact_id, COUNT(*) as shared_count
                FROM artifact_commits ac
                JOIN target_commits tc ON ac.commit_sha = tc.commit_sha
                WHERE ac.artifact_id != (SELECT id FROM target)
                GROUP BY ac.artifact_id
              )
              SELECT a.path, c.shared_count,
                CAST(c.shared_count AS REAL) / (
                  (SELECT COUNT(*) FROM target_commits) +
                  (SELECT COUNT(*) FROM artifact_commits WHERE artifact_id = c.artifact_id) -
                  c.shared_count
                ) AS jaccard
              FROM cochanges c
              JOIN artifacts a ON a.id = c.artifact_id
              WHERE a.alive = 1
              ORDER BY c.shared_count DESC
              LIMIT ?`,
              [path, lim],
            )) as unknown as { path: string; shared_count: number; jaccard: number }[];

            return {
              path,
              cochanges: rows.map((r) => ({
                path: r.path,
                count: r.shared_count,
                jaccard: r.jaccard,
              })),
              total_commits,
            };
          }),
        );
      },
    },

    {
      name: "kiste_list_tags",
      description: "List all tags with their artifact counts.",
      annotations: READ_ONLY,
      inputSchema: {},
      handler: async () => {
        return run(
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
        );
      },
    },
  ];
}
