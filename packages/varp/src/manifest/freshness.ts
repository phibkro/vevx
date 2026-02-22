import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, basename } from "node:path";

import {
  componentPaths,
  type Manifest,
  type FreshnessReport,
  type WarmStalenessResult,
} from "#shared/types.js";

import { discoverDocs } from "./discovery.js";

// ── I/O helpers ──

/** Matches test files: *.test.ts, *.spec.ts, *.test.js, *.spec.js, etc. */
const TEST_FILE_RE = /\.(test|spec)\.[jt]sx?$/;

export function getLatestMtime(dirPath: string, excludePaths?: Set<string>): Date | null {
  try {
    const entries = readdirSync(dirPath, {
      withFileTypes: true,
      recursive: true,
    });
    let latest: Date | null = null;
    for (const entry of entries) {
      if (entry.isFile()) {
        if (TEST_FILE_RE.test(entry.name)) continue;
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

/** Default tolerance in milliseconds — mtime differences below this are not considered stale. */
const DEFAULT_STALENESS_THRESHOLD_MS = 5000;

/**
 * Compute staleness for a set of docs against a source mtime.
 * Pure function — no I/O, fully testable with synthetic data.
 *
 * A doc is stale when its mtime is more than the staleness threshold behind
 * the source mtime. This avoids false positives from batch edits where
 * source and docs are updated within seconds of each other.
 */
export function computeStaleness(
  sourceMtime: Date | null,
  docs: DocTimestamp[],
  componentPath: string,
  acks?: Record<string, string>,
  stalenessThresholdMs?: number,
): Record<string, { path: string; last_modified: string; stale: boolean }> {
  const result: Record<string, { path: string; last_modified: string; stale: boolean }> = {};

  for (const doc of docs) {
    const rel = relative(componentPath, doc.path);
    const docKey = rel.startsWith("..") ? basename(doc.path, ".md") : rel.replace(/\.md$/, "");

    // Use the latest of doc mtime and ack time for staleness comparison
    let effectiveTime = doc.mtime?.getTime() ?? 0;
    const ackIso = acks?.[doc.path];
    if (ackIso) {
      const ackTime = new Date(ackIso).getTime();
      if (ackTime > effectiveTime) effectiveTime = ackTime;
    }

    const stale =
      !effectiveTime ||
      !sourceMtime ||
      sourceMtime.getTime() - effectiveTime >
        (stalenessThresholdMs ?? DEFAULT_STALENESS_THRESHOLD_MS);
    result[docKey] = {
      path: doc.path,
      last_modified: doc.mtime?.toISOString() ?? "N/A",
      stale,
    };
  }

  return result;
}

// ── Ack sidecar I/O ──

const ACK_DIR = ".varp";
const ACK_FILENAME = "freshness.json";

export function loadAcks(manifestDir: string): Record<string, string> {
  try {
    return JSON.parse(readFileSync(join(manifestDir, ACK_DIR, ACK_FILENAME), "utf-8"));
  } catch {
    // Fall back to legacy location for migration
    try {
      return JSON.parse(readFileSync(join(manifestDir, ".varp-freshness.json"), "utf-8"));
    } catch {
      return {};
    }
  }
}

export function saveAcks(manifestDir: string, acks: Record<string, string>): void {
  const dir = join(manifestDir, ACK_DIR);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, ACK_FILENAME), JSON.stringify(acks, null, 2) + "\n");
}

// ── Effectful wrapper ──

export function checkFreshness(manifest: Manifest, manifestDir?: string): FreshnessReport {
  const acks = manifestDir ? loadAcks(manifestDir) : undefined;
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
      docs: computeStaleness(sourceMtime, docTimestamps, paths[0], acks),
      source_last_modified: sourceMtime?.toISOString() ?? "N/A",
    };
  }

  return { components };
}

/** Acknowledge docs as reviewed. Records current timestamp in sidecar file. */
export function ackFreshness(
  manifest: Manifest,
  manifestDir: string,
  components: string[],
  doc?: string,
): { acked: string[] } {
  const acks = loadAcks(manifestDir);
  const now = new Date().toISOString();
  const acked: string[] = [];

  for (const name of components) {
    const component = manifest.components[name];
    if (!component) continue;

    const allDocs = discoverDocs(component);
    for (const docPath of allDocs) {
      if (doc) {
        // Filter by doc key — match against basename without .md or relative path key
        const paths = componentPaths(component);
        const rel = relative(paths[0], docPath);
        const docKey = rel.startsWith("..") ? basename(docPath, ".md") : rel.replace(/\.md$/, "");
        if (docKey !== doc) continue;
      }
      acks[docPath] = now;
      acked.push(docPath);
    }
  }

  saveAcks(manifestDir, acks);
  return { acked };
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
