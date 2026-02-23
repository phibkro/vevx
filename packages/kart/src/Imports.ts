/**
 * Import graph queries — impure shell.
 *
 * Reads files from disk, injects bunResolve, delegates to pure ImportGraph.
 * Stateless async functions — no Effect or LSP dependency.
 */

import { readFileSync, readdirSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { buildImportGraph, extractFileImports, transitiveImporters } from "./pure/ImportGraph.js";
import {
  bunResolve,
  loadTsconfigPaths,
  resolveSpecifier,
  type PathAliases,
} from "./pure/Resolve.js";
import type { ImportersResult, ImportsResult } from "./pure/types.js";

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
const EXCLUDED_DIRS = new Set(["node_modules", ".git", "dist", "build", ".varp"]);
const TS_EXTENSIONS = new Set([".ts", ".tsx"]);

// ── File collection ──

function collectTsFiles(dir: string): string[] {
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
      results.push(...collectTsFiles(join(dir, entry.name)));
    } else if (entry.isFile()) {
      const dot = entry.name.lastIndexOf(".");
      if (dot !== -1 && TS_EXTENSIONS.has(entry.name.slice(dot))) {
        results.push(join(dir, entry.name));
      }
    }
  }

  return results;
}

function loadSources(rootDir: string): Map<string, string> {
  const files = collectTsFiles(safeRealpath(rootDir));
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

function makeResolver(
  rootDir: string,
): (specifier: string, fromDir: string) => string | null {
  const aliases = loadTsconfigPaths(rootDir);
  return (specifier: string, fromDir: string) =>
    resolveSpecifier(specifier, fromDir, bunResolve, aliases ?? undefined);
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

  const aliases = loadTsconfigPaths(root);
  const resolveFn = (specifier: string, fromDir: string) =>
    resolveSpecifier(specifier, fromDir, bunResolve, aliases ?? undefined);

  const extracted = extractFileImports(source, absPath);
  const fromDir = dirname(absPath);

  const imports = extracted.imports.map((imp) => ({
    specifier: imp.specifier,
    resolvedPath: resolveFn(imp.specifier, fromDir),
    importedNames: imp.importedNames,
    isTypeOnly: imp.isTypeOnly,
  }));

  return { path: absPath, imports, totalImports: imports.length };
}

/** Get all files that import the given file (with barrel expansion). */
export async function getImporters(
  filePath: string,
  rootDir?: string,
): Promise<ImportersResult> {
  const root = safeRealpath(rootDir ?? process.cwd());
  const absPath = safeRealpath(resolve(filePath));

  if (!isWithinWorkspace(absPath, root)) {
    return { path: absPath, directImporters: [], barrelImporters: [], totalImporters: 0 };
  }

  const sources = loadSources(root);
  const resolveFn = makeResolver(root);
  const graph = buildImportGraph(sources, resolveFn);
  const result = transitiveImporters(absPath, graph);

  return { path: absPath, ...result };
}
