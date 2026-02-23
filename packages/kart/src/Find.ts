/**
 * Workspace-wide symbol search for TypeScript and Rust.
 *
 * Recursively collects .ts/.tsx/.rs files, parses each with the appropriate
 * parser (oxc for TS, tree-sitter for Rust), and filters by name, kind,
 * and export status.
 *
 * Parsed symbols are cached in memory keyed by path + mtime. First call
 * pays the full scan cost; subsequent calls only re-parse changed files.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";

import { parseSymbols, type OxcSymbol } from "./pure/OxcSymbols.js";
import { initRustParser, isRustParserReady, parseRustSymbols } from "./pure/RustSymbols.js";

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
  /** Total source files scanned (.ts/.tsx/.rs). */
  readonly fileCount: number;
  /** Files served from cache (0 on cold start). */
  readonly cachedFiles: number;
  /** Milliseconds elapsed. */
  readonly durationMs: number;
};

// ── Constants ──

const EXCLUDED_DIRS = new Set(["node_modules", ".git", "dist", "build", ".varp", "target"]);
const SUPPORTED_EXTENSIONS = new Set([".ts", ".tsx", ".rs"]);

// ── Symbol cache ──

type CacheEntry = { mtimeMs: number; symbols: OxcSymbol[] };
const symbolCache = new Map<string, CacheEntry>();

/** Clear the symbol cache. Called by kart_restart. */
export function clearSymbolCache(): void {
  symbolCache.clear();
}

/** Evict a single file from the symbol cache. Used by the file watcher. */
export function invalidateCacheEntry(absPath: string): void {
  symbolCache.delete(absPath);
}

// ── Implementation ──

export async function findSymbols(args: FindArgs): Promise<FindResult> {
  const start = performance.now();
  const rootDir = args.rootDir ?? process.cwd();
  const searchDir = args.path ? join(rootDir, args.path) : rootDir;

  // 1. Collect all .ts/.tsx paths with mtime
  const files = await collectFiles(searchDir);

  // 2. Parse or use cache (parallel on cold start)
  let cachedFiles = 0;
  const currentPaths = new Set<string>();

  const parseResults = await Promise.all(
    files.map(async (f) => {
      currentPaths.add(f.path);

      const cached = symbolCache.get(f.path);
      if (cached && cached.mtimeMs === f.mtimeMs) {
        cachedFiles++;
        return { path: f.path, symbols: cached.symbols };
      }

      const source = await readFile(f.path, "utf-8");
      const symbols = await parseFile(source, f.path);
      symbolCache.set(f.path, { mtimeMs: f.mtimeMs, symbols });
      return { path: f.path, symbols };
    }),
  );

  // 3. Evict cache entries for deleted files
  for (const key of symbolCache.keys()) {
    if (!currentPaths.has(key)) {
      symbolCache.delete(key);
    }
  }

  // 4. Filter symbols by query
  const symbols: FoundSymbol[] = [];

  for (const { path: absPath, symbols: parsed } of parseResults) {
    const relPath = relative(rootDir, absPath);

    for (const sym of parsed) {
      if (args.name && !sym.name.includes(args.name)) continue;
      if (args.kind !== undefined && sym.kind !== args.kind) continue;
      if (args.exported !== undefined && sym.exported !== args.exported) continue;

      symbols.push({ ...sym, file: relPath });
    }
  }

  return {
    symbols,
    fileCount: files.length,
    cachedFiles,
    durationMs: Math.round(performance.now() - start),
  };
}

// ── Multi-language parse router ──

async function parseFile(source: string, path: string): Promise<OxcSymbol[]> {
  if (path.endsWith(".rs")) {
    if (!isRustParserReady()) await initRustParser();
    return parseRustSymbols(source, path);
  }
  return parseSymbols(source, path);
}

// ── File collection ──

type FileEntry = { path: string; mtimeMs: number };

/** Recursively collect .ts/.tsx files with mtime, excluding common non-source directories. */
async function collectFiles(dir: string): Promise<FileEntry[]> {
  const results: FileEntry[] = [];

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
      if (SUPPORTED_EXTENSIONS.has(ext)) {
        const filePath = join(dir, entry.name);
        try {
          const st = await stat(filePath);
          results.push({ path: filePath, mtimeMs: st.mtimeMs });
        } catch {
          // File disappeared between readdir and stat — skip
        }
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
