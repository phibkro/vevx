/**
 * Import graph queries — impure shell.
 *
 * Reads files from disk, injects bunResolve, delegates to pure ImportGraph.
 * Stateless async functions — no Effect or LSP dependency.
 */

import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import {
  buildImportGraph,
  extractFileImports,
  findUnusedExports,
  transitiveImporters,
} from "./pure/ImportGraph.js";
import { bunResolve, loadTsconfigPaths, resolveSpecifier } from "./pure/Resolve.js";
import {
  ensureRustImportParser,
  extractRustFileImportsAsync,
  extractRustFileImportsSync,
  rustResolve,
} from "./pure/RustImports.js";
import type { ImportersResult, ImportsResult, UnusedExportsResult } from "./pure/types.js";

/** Resolve symlinks, returning the input unchanged if the path doesn't exist. */
function safeRealpath(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

// ── Constants ──

const FILE_CAP = 2000;
const EXCLUDED_DIRS = new Set(["node_modules", ".git", "dist", "build", ".varp", "target"]);
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".rs"]);

// ── File collection ──

function collectSourceFiles(dir: string): string[] {
  const results: string[] = [];

  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      results.push(...collectSourceFiles(join(dir, entry.name)));
    } else if (entry.isFile()) {
      const dot = entry.name.lastIndexOf(".");
      if (dot !== -1 && SOURCE_EXTENSIONS.has(entry.name.slice(dot))) {
        results.push(join(dir, entry.name));
      }
    }
  }

  return results;
}

function loadSources(rootDir: string): Map<string, string> {
  const files = collectSourceFiles(safeRealpath(rootDir));
  const capped = files.length > FILE_CAP ? files.slice(0, FILE_CAP) : files;
  const sources = new Map<string, string>();

  for (const filePath of capped) {
    try {
      sources.set(filePath, readFileSync(filePath, "utf-8"));
    } catch {
      /* skip unreadable files */
    }
  }

  return sources;
}

function makeResolver(rootDir: string): (specifier: string, fromDir: string) => string | null {
  const aliases = loadTsconfigPaths(rootDir);
  const crateRoot = findCrateRoot(rootDir);
  return (specifier: string, fromDir: string) => {
    // If specifier looks like a Rust path (contains ::), use Rust resolver
    if (specifier.includes("::")) {
      return rustResolve(specifier, fromDir, crateRoot);
    }
    return resolveSpecifier(specifier, fromDir, bunResolve, aliases ?? undefined);
  };
}

/** Dispatch extraction to the correct parser based on file extension. */
function makeExtractor(): (
  source: string,
  filename: string,
) => Omit<import("./pure/types.js").FileImports, "path"> {
  return (source: string, filename: string) => {
    if (filename.endsWith(".rs")) {
      return extractRustFileImportsSync(source, filename);
    }
    return extractFileImports(source, filename);
  };
}

/** Walk up from rootDir to find the nearest Cargo.toml for crate root detection. */
function findCrateRoot(rootDir: string): string | undefined {
  let dir = rootDir;
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, "Cargo.toml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

function isWithinWorkspace(filePath: string, rootDir: string): boolean {
  const resolved = resolve(filePath);
  const root = resolve(rootDir);
  return resolved.startsWith(root + "/") || resolved === root;
}

// ── Public API ──

export type ImportsArgs = {
  path: string;
  rootDir?: string;
};

export type ImportersArgs = {
  path: string;
  rootDir?: string;
};

/** Get imports for a single file. */
export async function getImports(filePath: string, rootDir?: string): Promise<ImportsResult> {
  const root = safeRealpath(rootDir ?? process.cwd());
  const absPath = safeRealpath(resolve(filePath));

  if (!isWithinWorkspace(absPath, root)) {
    return { path: absPath, imports: [], totalImports: 0 };
  }

  let source: string;
  try {
    source = readFileSync(absPath, "utf-8");
  } catch {
    return { path: absPath, imports: [], totalImports: 0 };
  }

  const fromDir = dirname(absPath);
  const isRust = absPath.endsWith(".rs");

  const extracted = isRust
    ? await extractRustFileImportsAsync(source, absPath)
    : extractFileImports(source, absPath);

  const crateRoot = isRust ? findCrateRoot(root) : undefined;
  const resolveFn = isRust
    ? (specifier: string, dir: string) => rustResolve(specifier, dir, crateRoot)
    : (() => {
        const aliases = loadTsconfigPaths(root);
        return (specifier: string, dir: string) =>
          resolveSpecifier(specifier, dir, bunResolve, aliases ?? undefined);
      })();

  const imports = extracted.imports.map((imp) => ({
    specifier: imp.specifier,
    resolvedPath: resolveFn(imp.specifier, fromDir),
    importedNames: imp.importedNames,
    isTypeOnly: imp.isTypeOnly,
  }));

  return { path: absPath, imports, totalImports: imports.length };
}

export type UnusedExportsArgs = {
  rootDir?: string;
};

/** Find exports that are not imported by any other file in the workspace. */
export async function getUnusedExports(rootDir?: string): Promise<UnusedExportsResult> {
  const start = performance.now();
  const root = safeRealpath(rootDir ?? process.cwd());
  const sources = loadSources(root);
  const resolveFn = makeResolver(root);

  // Init Rust parser if we have .rs files
  const hasRust = [...sources.keys()].some((p) => p.endsWith(".rs"));
  if (hasRust) await ensureRustImportParser();

  const graph = buildImportGraph(sources, resolveFn, makeExtractor());
  const unused = findUnusedExports(graph);

  // Count total exports across non-barrel files
  let totalExports = 0;
  for (const [, file] of graph.files) {
    if (!file.isBarrel) totalExports += file.exportedNames.length;
  }

  return {
    unusedExports: unused,
    totalUnused: unused.length,
    totalExports,
    fileCount: graph.fileCount,
    durationMs: Math.round(performance.now() - start),
  };
}

/** Get all files that import the given file (with barrel expansion). */
export async function getImporters(filePath: string, rootDir?: string): Promise<ImportersResult> {
  const root = safeRealpath(rootDir ?? process.cwd());
  const absPath = safeRealpath(resolve(filePath));

  if (!isWithinWorkspace(absPath, root)) {
    return { path: absPath, directImporters: [], barrelImporters: [], totalImporters: 0 };
  }

  const sources = loadSources(root);
  const resolveFn = makeResolver(root);

  // Init Rust parser if we have .rs files
  const hasRust = [...sources.keys()].some((p) => p.endsWith(".rs"));
  if (hasRust) await ensureRustImportParser();

  const graph = buildImportGraph(sources, resolveFn, makeExtractor());
  const result = transitiveImporters(absPath, graph);

  return { path: absPath, ...result };
}
