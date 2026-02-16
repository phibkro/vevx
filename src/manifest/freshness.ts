import { statSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Manifest, FreshnessReport } from "../types.js";

function getLatestMtime(dirPath: string): Date | null {
  try {
    const entries = readdirSync(dirPath, {
      withFileTypes: true,
      recursive: true,
    });
    let latest: Date | null = null;
    for (const entry of entries) {
      if (entry.isFile()) {
        const fullPath = join((entry as any).parentPath ?? dirPath, entry.name);
        try {
          const stat = statSync(fullPath);
          if (!latest || stat.mtime > latest) {
            latest = stat.mtime;
          }
        } catch {
          /* skip unreadable files */
        }
      }
    }
    return latest;
  } catch {
    return null;
  }
}

function getFileMtime(filePath: string): Date | null {
  try {
    return statSync(filePath).mtime;
  } catch {
    return null;
  }
}

export function checkFreshness(manifest: Manifest): FreshnessReport {
  const components: FreshnessReport["components"] = {};

  for (const [name, component] of Object.entries(manifest.components)) {
    const sourceMtime = getLatestMtime(component.path);
    const sourceTs = sourceMtime?.toISOString() ?? "N/A";

    const docs: Record<string, { path: string; last_modified: string; stale: boolean }> = {};
    for (const doc of component.docs) {
      const docMtime = getFileMtime(doc.path);
      docs[doc.name] = {
        path: doc.path,
        last_modified: docMtime?.toISOString() ?? "N/A",
        stale: !docMtime || !sourceMtime || docMtime < sourceMtime,
      };
    }

    components[name] = { docs, source_last_modified: sourceTs };
  }

  // Project-level docs
  let project_docs: FreshnessReport["project_docs"];
  if (manifest.docs) {
    project_docs = {};
    for (const [name, doc] of Object.entries(manifest.docs)) {
      const docMtime = getFileMtime(doc.path);
      project_docs[name] = {
        path: doc.path,
        last_modified: docMtime?.toISOString() ?? "N/A",
        stale: !docMtime,
      };
    }
  }

  return { components, ...(project_docs ? { project_docs } : {}) };
}
