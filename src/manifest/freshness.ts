import { statSync, readdirSync } from "node:fs";
import { join, relative, basename } from "node:path";
import type { Manifest, FreshnessReport } from "../types.js";
import { discoverDocs } from "./discovery.js";

// ── I/O helpers ──

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

// ── Pure computation ──

export type DocTimestamp = { path: string; mtime: Date | null };

/**
 * Compute staleness for a set of docs against a source mtime.
 * Pure function — no I/O, fully testable with synthetic data.
 */
export function computeStaleness(
  sourceMtime: Date | null,
  docs: DocTimestamp[],
  componentPath: string,
): Record<string, { path: string; last_modified: string; stale: boolean }> {
  const result: Record<string, { path: string; last_modified: string; stale: boolean }> = {};

  for (const doc of docs) {
    const rel = relative(componentPath, doc.path);
    const docKey = rel.startsWith("..") ? basename(doc.path, ".md") : rel.replace(/\.md$/, "");
    result[docKey] = {
      path: doc.path,
      last_modified: doc.mtime?.toISOString() ?? "N/A",
      stale: !doc.mtime || !sourceMtime || doc.mtime < sourceMtime,
    };
  }

  return result;
}

// ── Effectful wrapper ──

export function checkFreshness(manifest: Manifest): FreshnessReport {
  const components: FreshnessReport["components"] = {};

  for (const [name, component] of Object.entries(manifest.components)) {
    const sourceMtime = getLatestMtime(component.path);
    const allDocs = discoverDocs(component);
    const docTimestamps: DocTimestamp[] = allDocs.map((p) => ({ path: p, mtime: getFileMtime(p) }));

    components[name] = {
      docs: computeStaleness(sourceMtime, docTimestamps, component.path),
      source_last_modified: sourceMtime?.toISOString() ?? "N/A",
    };
  }

  return { components };
}
