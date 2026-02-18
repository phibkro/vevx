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
 * Detect domain directories that contain 2+ layer subdirectories.
 * For projects structured as `src/auth/controllers/`, `src/auth/services/`, etc.
 */
export function detectDomainDirs(
  rootDir: string,
  layerNames?: Set<string>,
): { name: string; layers: string[] }[] {
  const layers = layerNames ?? DEFAULT_LAYER_NAMES;
  const results: { name: string; layers: string[] }[] = [];

  let topDirs: string[];
  try {
    topDirs = readdirSync(rootDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }

  for (const dir of topDirs) {
    let subdirs: string[];
    try {
      subdirs = readdirSync(join(rootDir, dir), { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
    } catch {
      continue;
    }

    const matchingLayers = subdirs.filter((s) => layers.has(s)).sort();
    if (matchingLayers.length >= 2) {
      results.push({ name: dir, layers: matchingLayers });
    }
  }

  return results.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Suggest components from domain-organized projects.
 * Each domain dir with 2+ layer subdirs becomes a component with multi-path.
 */
export function suggestComponentsFromDomains(
  rootDir: string,
  opts?: { layerNames?: Set<string> },
): SuggestComponentsResult {
  const domains = detectDomainDirs(rootDir, opts?.layerNames);

  const components: SuggestedComponent[] = domains.map((domain) => ({
    name: domain.name,
    path: domain.layers.map((layer) => join(domain.name, layer)),
    evidence: domain.layers.map((layer) => ({
      stem: `${domain.name}/${layer}`,
      files: listCodeFiles(join(rootDir, domain.name, layer)),
    })),
  }));

  const allLayers = new Set<string>();
  for (const d of domains) {
    for (const l of d.layers) allLayers.add(l);
  }

  return {
    components,
    layer_dirs_scanned: [...allLayers].sort(),
  };
}

/**
 * Scan a project's layer directories to suggest multi-path component groupings.
 * Supports three modes:
 * - "layers": files organized by layer dirs at root (controllers/, services/)
 * - "domains": domain dirs at root containing layer subdirs (auth/controllers/, auth/services/)
 * - "auto": run both and merge results (dedup by name)
 */
export function suggestComponents(
  rootDir: string,
  opts?: { layerDirs?: string[]; suffixes?: string[]; mode?: "layers" | "domains" | "auto" },
): SuggestComponentsResult {
  const mode = opts?.mode ?? "auto";

  if (mode === "domains") {
    return suggestComponentsFromDomains(rootDir);
  }

  const layerResult = suggestComponentsFromLayers(rootDir, opts);

  if (mode === "layers") {
    return layerResult;
  }

  // auto: merge both
  const domainResult = suggestComponentsFromDomains(rootDir);

  const seen = new Set<string>();
  const merged: SuggestedComponent[] = [];

  // Layer results take priority
  for (const comp of layerResult.components) {
    seen.add(comp.name);
    merged.push(comp);
  }
  for (const comp of domainResult.components) {
    if (!seen.has(comp.name)) {
      merged.push(comp);
    }
  }

  merged.sort((a, b) => a.name.localeCompare(b.name));

  const allLayerDirs = new Set([
    ...layerResult.layer_dirs_scanned,
    ...domainResult.layer_dirs_scanned,
  ]);

  return {
    components: merged,
    layer_dirs_scanned: [...allLayerDirs].sort(),
  };
}

function suggestComponentsFromLayers(
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

/** List code files in a directory (non-recursive). */
function listCodeFiles(dirPath: string): string[] {
  try {
    return readdirSync(dirPath).filter((name) => {
      const ext = getExtension(name);
      return CODE_EXTENSIONS.has(ext);
    });
  } catch {
    return [];
  }
}

// ── Helpers ──

function getExtension(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  return lastDot === -1 ? "" : filename.slice(lastDot);
}
