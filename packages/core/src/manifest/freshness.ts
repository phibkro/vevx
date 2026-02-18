import { statSync, readdirSync } from "node:fs";
import { join, relative, basename } from "node:path";

import {
  componentPaths,
  type Manifest,
  type FreshnessReport,
  type WarmStalenessResult,
} from "#shared/types.js";

import { discoverDocs } from "./discovery.js";

// ── I/O helpers ──

export function getLatestMtime(dirPath: string, excludePaths?: Set<string>): Date | null {
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
    const paths = componentPaths(component);

    // Aggregate source mtime across all paths — take the latest
    let sourceMtime: Date | null = null;
    for (const p of paths) {
      const mtime = getLatestMtime(p, docPathSet);
      if (mtime && (!sourceMtime || mtime > sourceMtime)) {
        sourceMtime = mtime;
      }
    }

    const docTimestamps: DocTimestamp[] = allDocs.map((p) => ({ path: p, mtime: getFileMtime(p) }));

    components[name] = {
      docs: computeStaleness(sourceMtime, docTimestamps, paths[0]),
      source_last_modified: sourceMtime?.toISOString() ?? "N/A",
    };
  }

  return { components };
}

/** Check whether components have been modified since a baseline timestamp. */
export function checkWarmStaleness(
  manifest: Manifest,
  components: string[],
  since: Date,
): WarmStalenessResult {
  const stale_components: WarmStalenessResult["stale_components"] = [];

  for (const name of components) {
    const component = manifest.components[name];
    if (!component) continue;

    const docPathSet = new Set(discoverDocs(component));
    const paths = componentPaths(component);

    let sourceMtime: Date | null = null;
    for (const p of paths) {
      const mtime = getLatestMtime(p, docPathSet);
      if (mtime && (!sourceMtime || mtime > sourceMtime)) {
        sourceMtime = mtime;
      }
    }

    if (sourceMtime && sourceMtime > since) {
      stale_components.push({
        component: name,
        source_last_modified: sourceMtime.toISOString(),
      });
    }
  }

  const safe_to_resume = stale_components.length === 0;
  const summary = safe_to_resume
    ? "No changes detected"
    : `Components ${stale_components.map((s) => s.component).join(", ")} modified since last dispatch`;

  return { safe_to_resume, stale_components, summary };
}
