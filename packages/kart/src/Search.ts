/**
 * Workspace-wide pattern search using ripgrep.
 *
 * Shells out to `rg --json` for fast, gitignore-aware text search.
 * Pure async function — no Effect or LSP dependency.
 */

import { relative, resolve } from "node:path";

// ── Types ──

export type SearchArgs = {
  /** Regex pattern to search for. */
  pattern: string;
  /** File filter glob, e.g. "*.ts". */
  glob?: string;
  /** Restrict search to specific paths (relative to rootDir). */
  paths?: string[];
  /** Workspace root. Defaults to process.cwd(). */
  rootDir?: string;
};

export type SearchMatch = {
  readonly path: string;
  readonly line: number;
  readonly text: string;
};

export type SearchResult = {
  readonly matches: SearchMatch[];
  /** True if matches exceeded the 100-match cap. */
  readonly truncated: boolean;
};

// ── Constants ──

const MATCH_CAP = 100;
const RG_MAX_COUNT = 1000;

// ── Implementation ──

export async function searchPattern(args: SearchArgs): Promise<SearchResult> {
  const rootDir = args.rootDir ?? process.cwd();

  const rgArgs = ["rg", "--json", "--max-count", String(RG_MAX_COUNT), args.pattern];

  if (args.glob) {
    rgArgs.push("--glob", args.glob);
  }

  if (args.paths && args.paths.length > 0) {
    for (const p of args.paths) {
      rgArgs.push(resolve(rootDir, p));
    }
  }

  const proc = Bun.spawn(rgArgs, {
    cwd: rootDir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = await new Response(proc.stdout).text();
  await proc.exited;

  // rg exits 1 when no matches found — that's normal
  const matches: SearchMatch[] = [];
  let truncated = false;

  for (const line of stdout.split("\n")) {
    if (!line) continue;

    let parsed: { type: string; data?: Record<string, unknown> };
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }

    if (parsed.type !== "match") continue;

    const data = parsed.data as {
      path: { text: string };
      line_number: number;
      lines: { text: string };
    };

    if (matches.length >= MATCH_CAP) {
      truncated = true;
      break;
    }

    const absPath = resolve(rootDir, data.path.text);
    matches.push({
      path: relative(rootDir, absPath),
      line: data.line_number,
      text: data.lines.text.trimEnd(),
    });
  }

  return { matches, truncated };
}
