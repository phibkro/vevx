import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import type { SuggestedComponent, SuggestComponentsResult } from "#shared/types.js";

// ── Constants ──

const DEFAULT_LAYER_NAMES = new Set([
  "controllers",
  "services",
  "repositories",
  "handlers",
  "models",
  "routes",
  "middleware",
  "providers",
]);

const DEFAULT_SUFFIXES = [
  ".controller",
  ".service",
  ".repository",
  ".model",
  ".handler",
  ".route",
  ".middleware",
  ".provider",
];

const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);

// ── Types ──

export interface StemEntry {
  /** Layer directory name (e.g. "controllers") */
  layerDir: string;
  /** Name stem (e.g. "user") */
  stem: string;
  /** Original filename (e.g. "user.controller.ts") */
  filename: string;
}

// ── Pure Functions ──

/**
 * Strip a known suffix + file extension to extract the name stem.
 * Returns null if the file has no code extension.
 */
export function extractStem(filename: string, suffixes: string[]): string | null {
  // Find the code extension
  const ext = CODE_EXTENSIONS.has(getExtension(filename)) ? getExtension(filename) : null;
  if (!ext) return null;

  const withoutExt = filename.slice(0, -ext.length);

  for (const suffix of suffixes) {
    if (withoutExt.endsWith(suffix)) {
      return withoutExt.slice(0, -suffix.length);
    }
  }

  // No known suffix — use the filename without extension as the stem
  return withoutExt;
}

/**
 * Group stem entries by name across layer directories.
 * Only stems appearing in 2+ distinct layers become suggested components.
 */
export function clusterByNameStem(entries: StemEntry[]): SuggestedComponent[] {
  // Group by stem
  const byName = new Map<string, Map<string, string[]>>();

  for (const { stem, layerDir, filename } of entries) {
    let layers = byName.get(stem);
    if (!layers) {
      layers = new Map<string, string[]>();
      byName.set(stem, layers);
    }
    let files = layers.get(layerDir);
    if (!files) {
      files = [];
      layers.set(layerDir, files);
    }
    files.push(filename);
  }

  // Filter to stems in 2+ layers
  const results: SuggestedComponent[] = [];
  for (const [stem, layers] of byName) {
    if (layers.size < 2) continue;

    const path: string[] = [];
    const evidence: { stem: string; files: string[] }[] = [];

    for (const [layerDir, files] of layers) {
      path.push(layerDir);
      evidence.push({ stem: `${layerDir}/${stem}`, files });
    }

    results.push({ name: stem, path: path.sort(), evidence });
  }

  return results.sort((a, b) => a.name.localeCompare(b.name));
}

// ── Effectful Functions ──

/**
 * Detect conventional layer directories within rootDir.
 * Returns relative directory names that match known layer conventions.
 */
export function detectLayerDirs(rootDir: string): string[] {
  try {
    const entries = readdirSync(rootDir, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && DEFAULT_LAYER_NAMES.has(e.name))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

/**
 * Scan a project's layer directories to suggest multi-path component groupings.
 */
export function suggestComponents(
  rootDir: string,
  opts?: { layerDirs?: string[]; suffixes?: string[] },
): SuggestComponentsResult {
  const suffixes = opts?.suffixes ?? DEFAULT_SUFFIXES;
  const layerDirs = opts?.layerDirs ?? detectLayerDirs(rootDir);

  const stemEntries: StemEntry[] = [];

  for (const layerDir of layerDirs) {
    const layerPath = join(rootDir, layerDir);
    let entries: string[];
    try {
      entries = readdirSync(layerPath).filter((name) => {
        try {
          return statSync(join(layerPath, name)).isFile();
        } catch {
          return false;
        }
      });
    } catch {
      continue;
    }

    for (const filename of entries) {
      const stem = extractStem(filename, suffixes);
      if (stem) {
        stemEntries.push({ layerDir, stem, filename });
      }
    }
  }

  return {
    components: clusterByNameStem(stemEntries),
    layer_dirs_scanned: layerDirs,
  };
}

// ── Helpers ──

function getExtension(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  return lastDot === -1 ? "" : filename.slice(lastDot);
}
