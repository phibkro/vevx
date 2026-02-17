import { statSync, readdirSync } from "node:fs";
import { join, relative, basename } from "node:path";

import type { Manifest, FreshnessReport } from "../types.js";
import { discoverDocs } from "./discovery.js";

// ── I/O helpers ──

function getLatestMtime(dirPath: string, excludePaths?: Set<string>): Date | null {
  try {
    const entries = readdirSync(dirPath, {
      withFileTypes: true,
      recursive: true,
    });
    let latest: Date | null = null;
    for (const entry of entries) {
      if (entry.isFile()) {
        const fullPath = join((entry as any).parentPath ?? dirPath, entry.name);
        if (excludePaths?.has(fullPath)) continue;
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

/** Tolerance in milliseconds — mtime differences below this are not considered stale. */
const STALENESS_THRESHOLD_MS = 5000;

/**
 * Compute staleness for a set of docs against a source mtime.
 * Pure function — no I/O, fully testable with synthetic data.
 *
 * A doc is stale when its mtime is more than STALENESS_THRESHOLD_MS behind
 * the source mtime. This avoids false positives from batch edits where
 * source and docs are updated within seconds of each other.
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
    const stale =
      !doc.mtime ||
      !sourceMtime ||
      sourceMtime.getTime() - doc.mtime.getTime() > STALENESS_THRESHOLD_MS;
    result[docKey] = {
      path: doc.path,
      last_modified: doc.mtime?.toISOString() ?? "N/A",
      stale,
    };
  }

  return result;
}

// ── Effectful wrapper ──

export function checkFreshness(manifest: Manifest): FreshnessReport {
  const components: FreshnessReport["components"] = {};

  for (const [name, component] of Object.entries(manifest.components)) {
    const allDocs = discoverDocs(component);
    const docPathSet = new Set(allDocs);
    const sourceMtime = getLatestMtime(component.path, docPathSet);
    const docTimestamps: DocTimestamp[] = allDocs.map((p) => ({ path: p, mtime: getFileMtime(p) }));

    components[name] = {
      docs: computeStaleness(sourceMtime, docTimestamps, component.path),
      source_last_modified: sourceMtime?.toISOString() ?? "N/A",
    };
  }

  return { components };
}
