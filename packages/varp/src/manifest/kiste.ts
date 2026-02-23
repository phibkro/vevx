import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";

import { findOwningComponent, buildComponentPaths } from "#shared/ownership.js";
import type { Manifest, ImportDep } from "#shared/types.js";

/**
 * Read co-change dependencies from kiste's SQLite index.
 * Maps file-level co-changes to component-level ImportDep[] for use in suggestTouches.
 *
 * Returns [] if the kiste DB doesn't exist or can't be opened.
 */
export function readKisteCoChanges(
  filePaths: string[],
  manifest: Manifest,
  kisteDbPath: string,
  options?: { limit?: number; minJaccard?: number },
): ImportDep[] {
  if (!existsSync(kisteDbPath)) return [];

  let db: Database;
  try {
    db = new Database(kisteDbPath, { readonly: true });
  } catch {
    return [];
  }

  try {
    const limit = options?.limit ?? 20;
    const minJaccard = options?.minJaccard ?? 0.1;
    const componentPaths = buildComponentPaths(manifest);

    const depsMap = new Map<
      string,
      { from: string; to: string; evidence: { source_file: string; import_specifier: string }[] }
    >();

    const stmt = db.prepare(`
      WITH target AS (
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
      LIMIT ?
    `);

    for (const filePath of filePaths) {
      const fromComponent = findOwningComponent(filePath, manifest, componentPaths);
      if (!fromComponent) continue;

      const rows = stmt.all(filePath, limit) as {
        path: string;
        shared_count: number;
        jaccard: number;
      }[];

      for (const row of rows) {
        if (row.jaccard < minJaccard) continue;
        const toComponent = findOwningComponent(row.path, manifest, componentPaths);
        if (!toComponent || toComponent === fromComponent) continue;

        const key = `${fromComponent}->${toComponent}`;
        const existing = depsMap.get(key);
        const evidence = {
          source_file: filePath,
          import_specifier: `cochange:${row.jaccard.toFixed(3)}`,
        };
        if (existing) {
          existing.evidence.push(evidence);
        } else {
          depsMap.set(key, { from: fromComponent, to: toComponent, evidence: [evidence] });
        }
      }
    }

    return Array.from(depsMap.values());
  } finally {
    db.close();
  }
}
