import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";

import type { SuggestedComponent, SuggestComponentsResult } from "#shared/types.js";

// ── Detection Config ──

/**
 * Declarative configuration for component detection conventions.
 * Each field documents a category of heuristic used by `suggestComponents`.
 */
export interface DetectionConfig {
  /** Directories whose subdirectories are treated as components (e.g. "packages", "apps"). */
  containerDirs: string[];
  /** Subdirectories that indicate their parent directory is a component (e.g. "src", "app"). */
  indicatorDirs: string[];
  /** Conventional layer directory names for MVC-style detection. */
  layerDirs: string[];
  /** File suffixes stripped when extracting name stems (e.g. ".controller"). */
  suffixes: string[];
  /** File extensions considered as source code. */
  codeExtensions: string[];
}

export const DEFAULT_DETECTION_CONFIG: DetectionConfig = {
  containerDirs: ["packages", "apps", "modules", "libs"],
  indicatorDirs: ["src", "app", "lib", "test", "tests", "node_modules"],
  layerDirs: [
    "controllers",
    "services",
    "repositories",
    "handlers",
    "models",
    "routes",
    "middleware",
    "providers",
    "resolvers",
    "validators",
    "schemas",
    "entities",
    "components",
    "pages",
    "api",
    "hooks",
    "utils",
  ],
  suffixes: [
    ".controller",
    ".service",
    ".repository",
    ".model",
    ".handler",
    ".route",
    ".middleware",
    ".provider",
  ],
  codeExtensions: [".ts", ".tsx", ".js", ".jsx"],
};

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
export function extractStem(
  filename: string,
  suffixes: string[],
  config: DetectionConfig = DEFAULT_DETECTION_CONFIG,
): string | null {
  const codeExts = new Set(config.codeExtensions);
  // Find the code extension
  const ext = codeExts.has(getExtension(filename)) ? getExtension(filename) : null;
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

// ── Monorepo / Package Detection ──

/**
 * Read and parse package.json from a directory.
 * Returns null if the file doesn't exist or isn't valid JSON.
 */
function readPackageJson(dir: string): Record<string, unknown> | null {
  const pkgPath = join(dir, "package.json");
  try {
    return JSON.parse(readFileSync(pkgPath, "utf-8"));
  } catch {
    return null;
  }
}

/**
 * Resolve workspace glob patterns to directories containing package.json.
 * Handles both npm/bun (`workspaces: ["packages/*"]`) and
 * yarn (`workspaces: { packages: ["packages/*"] }`) formats.
 */
export function resolveWorkspacePatterns(rootDir: string, workspaces: unknown): string[] {
  let patterns: string[];

  if (Array.isArray(workspaces)) {
    patterns = workspaces.filter((w): w is string => typeof w === "string");
  } else if (
    typeof workspaces === "object" &&
    workspaces !== null &&
    "packages" in workspaces &&
    Array.isArray((workspaces as Record<string, unknown>).packages)
  ) {
    patterns = (workspaces as { packages: unknown[] }).packages.filter(
      (w): w is string => typeof w === "string",
    );
  } else {
    return [];
  }

  const dirs: string[] = [];

  for (const pattern of patterns) {
    // Handle simple glob: "packages/*" → list children of "packages/"
    if (pattern.endsWith("/*")) {
      const parentDir = join(rootDir, pattern.slice(0, -2));
      try {
        const entries = readdirSync(parentDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory() && existsSync(join(parentDir, entry.name, "package.json"))) {
            dirs.push(join(pattern.slice(0, -2), entry.name));
          }
        }
      } catch {
        // Parent doesn't exist, skip
      }
    } else {
      // Literal path
      if (existsSync(join(rootDir, pattern, "package.json"))) {
        dirs.push(pattern);
      }
    }
  }

  return dirs.sort();
}

/**
 * Detect workspace packages from root package.json.
 * Returns one component per workspace package, using the npm package name
 * (stripped of scope) as the component name.
 */
export function detectWorkspacePackages(rootDir: string): SuggestedComponent[] {
  const rootPkg = readPackageJson(rootDir);
  if (!rootPkg || !rootPkg.workspaces) return [];

  const packageDirs = resolveWorkspacePatterns(rootDir, rootPkg.workspaces);
  const components: SuggestedComponent[] = [];

  for (const relDir of packageDirs) {
    const pkg = readPackageJson(join(rootDir, relDir));
    const pkgName = typeof pkg?.name === "string" ? pkg.name : null;

    // Strip npm scope: "@varp/core" → "core"
    const name = pkgName ? pkgName.replace(/^@[^/]+\//, "") : basename(relDir);

    components.push({
      name,
      path: [relDir],
      evidence: [{ stem: pkgName ?? relDir, files: [] }],
    });
  }

  return components.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Detect components from common container directories (packages/, apps/, etc.)
 * without requiring a workspaces field in package.json.
 * Each subdirectory that contains source files or a package.json becomes a component.
 */
export function detectContainerComponents(
  rootDir: string,
  config: DetectionConfig = DEFAULT_DETECTION_CONFIG,
): SuggestedComponent[] {
  const containerNames = new Set(config.containerDirs);
  const components: SuggestedComponent[] = [];

  let topEntries: string[];
  try {
    topEntries = readdirSync(rootDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && containerNames.has(e.name))
      .map((e) => e.name);
  } catch {
    return [];
  }

  for (const containerDir of topEntries) {
    const containerPath = join(rootDir, containerDir);
    let subdirs: string[];
    try {
      subdirs = readdirSync(containerPath, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
    } catch {
      continue;
    }

    for (const subdir of subdirs) {
      const fullPath = join(containerPath, subdir);
      const hasPkg = existsSync(join(fullPath, "package.json"));
      const hasSrc = existsSync(join(fullPath, "src"));
      const hasCode = !hasPkg && !hasSrc && listCodeFiles(fullPath).length > 0;

      if (hasPkg || hasSrc || hasCode) {
        components.push({
          name: subdir,
          path: [join(containerDir, subdir)],
          evidence: [{ stem: `${containerDir}/${subdir}`, files: [] }],
        });
      }
    }
  }

  return components.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Detect components by finding directories that contain indicator subdirectories
 * (src/, app/, lib/, test/, tests/). The parent directory name becomes the component name.
 * Skips container dirs (already handled) and dotdirs/node_modules.
 */
export function detectSrcComponents(
  rootDir: string,
  config: DetectionConfig = DEFAULT_DETECTION_CONFIG,
): SuggestedComponent[] {
  const containerNames = new Set(config.containerDirs);
  const indicatorNames = new Set(config.indicatorDirs);
  const components: SuggestedComponent[] = [];

  let topEntries: string[];
  try {
    topEntries = readdirSync(rootDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }

  for (const dir of topEntries) {
    if (containerNames.has(dir)) continue; // Already handled by container detection
    if (dir.startsWith(".") || dir === "node_modules") continue;

    // Check if this dir contains any indicator subdirectory
    let subdirs: string[];
    try {
      subdirs = readdirSync(join(rootDir, dir), { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
    } catch {
      continue;
    }

    const indicators = subdirs.filter((s) => indicatorNames.has(s));
    if (indicators.length > 0) {
      // Use the first indicator dir for evidence (prefer src > app > lib)
      const evidenceDir = indicators.includes("src")
        ? "src"
        : indicators.includes("app")
          ? "app"
          : indicators[0];
      components.push({
        name: dir,
        path: [dir],
        evidence: [
          { stem: `${dir}/${evidenceDir}`, files: listCodeFiles(join(rootDir, dir, evidenceDir)) },
        ],
      });
    }
  }

  return components.sort((a, b) => a.name.localeCompare(b.name));
}

// ── Effectful Functions ──

/**
 * Detect conventional layer directories within rootDir.
 * Returns relative directory names that match known layer conventions.
 */
export function detectLayerDirs(
  rootDir: string,
  config: DetectionConfig = DEFAULT_DETECTION_CONFIG,
): string[] {
  const layerNames = new Set(config.layerDirs);
  try {
    const entries = readdirSync(rootDir, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && layerNames.has(e.name))
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
  config: DetectionConfig = DEFAULT_DETECTION_CONFIG,
): { name: string; layers: string[] }[] {
  const layers = layerNames ?? new Set(config.layerDirs);
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
 * Merge component arrays with dedup by name. Earlier arrays take priority.
 */
function mergeComponents(...sources: SuggestedComponent[][]): SuggestedComponent[] {
  const seen = new Set<string>();
  const merged: SuggestedComponent[] = [];

  for (const components of sources) {
    for (const comp of components) {
      if (!seen.has(comp.name)) {
        seen.add(comp.name);
        merged.push(comp);
      }
    }
  }

  return merged.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Scan a project to suggest component groupings.
 * Supports three modes:
 * - "layers": files organized by layer dirs at root (controllers/, services/)
 * - "domains": domain dirs at root containing layer subdirs (auth/controllers/, auth/services/)
 * - "auto": run all strategies and merge (dedup by name, highest-confidence first):
 *   workspace packages > container dirs > src-parent > layers > domains
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

  // auto: run all strategies, highest confidence first
  const workspaceComponents = detectWorkspacePackages(rootDir);
  const containerComponents = detectContainerComponents(rootDir);
  const srcComponents = detectSrcComponents(rootDir);
  const domainResult = suggestComponentsFromDomains(rootDir);

  const merged = mergeComponents(
    workspaceComponents,
    containerComponents,
    srcComponents,
    layerResult.components,
    domainResult.components,
  );

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
  config: DetectionConfig = DEFAULT_DETECTION_CONFIG,
): SuggestComponentsResult {
  const suffixes = opts?.suffixes ?? config.suffixes;
  const layerDirs = opts?.layerDirs ?? detectLayerDirs(rootDir, config);

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
function listCodeFiles(
  dirPath: string,
  config: DetectionConfig = DEFAULT_DETECTION_CONFIG,
): string[] {
  const codeExts = new Set(config.codeExtensions);
  try {
    return readdirSync(dirPath).filter((name) => {
      const ext = getExtension(name);
      return codeExts.has(ext);
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
