/**
 * Workspace-wide symbol search using oxc-parser.
 *
 * Recursively collects .ts/.tsx files, parses each with OxcSymbols,
 * and filters by name substring, kind, and export status.
 *
 * Stateless async function — no Effect or LSP dependency.
 */

import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

import { parseSymbols, type OxcSymbol } from "./pure/OxcSymbols.js";

// ── Types ──

export type FindArgs = {
  /** Substring match against symbol name. Empty string matches all. */
  name: string;
  /** Filter by symbol kind. */
  kind?: string;
  /** Filter by export status. */
  exported?: boolean;
  /** Restrict search to this subdirectory (relative to rootDir). */
  path?: string;
  /** Workspace root. Defaults to process.cwd(). */
  rootDir?: string;
};

export type FoundSymbol = OxcSymbol & {
  /** File path relative to rootDir. */
  readonly file: string;
};

export type FindResult = {
  readonly symbols: FoundSymbol[];
  /** True if file count exceeded the 2000-file cap. */
  readonly truncated: boolean;
  /** Total .ts/.tsx files found (before cap). */
  readonly fileCount: number;
  /** Milliseconds elapsed. */
  readonly durationMs: number;
};

// ── Constants ──

const FILE_CAP = 2000;
const EXCLUDED_DIRS = new Set(["node_modules", ".git", "dist", "build", ".varp"]);
const TS_EXTENSIONS = new Set([".ts", ".tsx"]);

// ── Implementation ──

export async function findSymbols(args: FindArgs): Promise<FindResult> {
  const start = performance.now();
  const rootDir = args.rootDir ?? process.cwd();
  const searchDir = args.path ? join(rootDir, args.path) : rootDir;

  const files = await collectFiles(searchDir);
  const totalFileCount = files.length;
  const truncated = totalFileCount > FILE_CAP;
  const capped = truncated ? files.slice(0, FILE_CAP) : files;

  const symbols: FoundSymbol[] = [];

  for (const absPath of capped) {
    const source = await readFile(absPath, "utf-8");
    const relPath = relative(rootDir, absPath);
    const parsed = parseSymbols(source, absPath);

    for (const sym of parsed) {
      if (args.name && !sym.name.includes(args.name)) continue;
      if (args.kind !== undefined && sym.kind !== args.kind) continue;
      if (args.exported !== undefined && sym.exported !== args.exported) continue;

      symbols.push({ ...sym, file: relPath });
    }
  }

  return {
    symbols,
    truncated,
    fileCount: totalFileCount,
    durationMs: Math.round(performance.now() - start),
  };
}

/** Recursively collect .ts/.tsx files, excluding common non-source directories. */
async function collectFiles(dir: string): Promise<string[]> {
  const results: string[] = [];

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      const sub = await collectFiles(join(dir, entry.name));
      results.push(...sub);
    } else if (entry.isFile()) {
      const ext = extname(entry.name);
      if (TS_EXTENSIONS.has(ext)) {
        results.push(join(dir, entry.name));
      }
    }
  }

  return results;
}

/** Extract file extension including the dot. */
function extname(name: string): string {
  const i = name.lastIndexOf(".");
  return i === -1 ? "" : name.slice(i);
}
