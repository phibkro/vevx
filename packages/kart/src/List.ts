import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

// ── Types ──

export type ListArgs = {
  path: string;
  recursive?: boolean;
  glob?: string;
  rootDir?: string;
};

export type ListEntry = {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
};

export type ListResult = {
  entries: ListEntry[];
  truncated: boolean;
};

// ── Constants ──

const EXCLUDED_DIRS = new Set(["node_modules", ".git", "dist", "build", ".varp"]);
const MAX_ENTRIES = 5000;

// ── Implementation ──

function matchesGlob(filename: string, pattern: string): boolean {
  const glob = new Bun.Glob(pattern);
  return glob.match(filename);
}

export function listDirectory(args: ListArgs): ListResult {
  const rootDir = resolve(args.rootDir ?? process.cwd());
  const absPath = resolve(rootDir, args.path);

  if (!existsSync(absPath)) {
    return { entries: [], truncated: false };
  }

  if (args.recursive) {
    return listRecursive(rootDir, absPath, args.glob);
  }

  return listFlat(rootDir, absPath, args.glob);
}

function listFlat(rootDir: string, absPath: string, glob?: string): ListResult {
  const raw = readdirSync(absPath);
  const entries: ListEntry[] = [];

  for (const name of raw) {
    if (EXCLUDED_DIRS.has(name)) continue;

    const fullPath = join(absPath, name);
    const stat = statSync(fullPath, { throwIfNoEntry: false });
    if (!stat) continue;

    const isDir = stat.isDirectory();
    if (glob && !isDir && !matchesGlob(name, glob)) continue;
    if (glob && isDir && !matchesGlob(name, glob)) continue;

    entries.push({
      name,
      path: relative(rootDir, fullPath),
      isDirectory: isDir,
      ...(isDir ? {} : { size: stat.size }),
    });
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));
  return { entries, truncated: false };
}

function listRecursive(rootDir: string, absPath: string, glob?: string): ListResult {
  const entries: ListEntry[] = [];
  let truncated = false;

  const walk = (dir: string): void => {
    if (truncated) return;

    let raw: string[];
    try {
      raw = readdirSync(dir);
    } catch {
      return;
    }

    for (const name of raw) {
      if (truncated) return;
      if (EXCLUDED_DIRS.has(name)) continue;

      const fullPath = join(dir, name);
      const stat = statSync(fullPath, { throwIfNoEntry: false });
      if (!stat) continue;

      if (stat.isDirectory()) {
        walk(fullPath);
      } else {
        if (glob && !matchesGlob(name, glob)) continue;

        entries.push({
          name,
          path: relative(rootDir, fullPath),
          isDirectory: false,
          size: stat.size,
        });

        if (entries.length >= MAX_ENTRIES) {
          truncated = true;
          return;
        }
      }
    }
  };

  walk(absPath);
  entries.sort((a, b) => a.path.localeCompare(b.path));
  return { entries, truncated };
}
