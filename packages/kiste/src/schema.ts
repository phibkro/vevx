/**
 * Shared Zod schemas for kiste's SQLite tables.
 *
 * These are the boundary contract between kiste and external consumers
 * (e.g. @vevx/varp) that read kiste's database directly.
 *
 * Only Zod — no Effect types. Consumers import `@vevx/kiste/schema`.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// artifacts table
// ---------------------------------------------------------------------------

export const ArtifactRow = z.object({
  id: z.number().int(),
  path: z.string(),
  alive: z.number().int(),
});
export type ArtifactRow = z.infer<typeof ArtifactRow>;

// ---------------------------------------------------------------------------
// artifact_commits junction table
// ---------------------------------------------------------------------------

export const ArtifactCommitRow = z.object({
  artifact_id: z.number().int(),
  commit_sha: z.string(),
});
export type ArtifactCommitRow = z.infer<typeof ArtifactCommitRow>;

// ---------------------------------------------------------------------------
// Co-change query result (computed from artifacts + artifact_commits)
// ---------------------------------------------------------------------------

export const CoChangeRow = z.object({
  path: z.string(),
  shared_count: z.number(),
  jaccard: z.number(),
});
export type CoChangeRow = z.infer<typeof CoChangeRow>;
