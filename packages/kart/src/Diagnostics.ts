/**
 * Workspace diagnostics via oxlint --type-aware.
 *
 * Stateless async module — no Effect or LSP dependency.
 * Returns structured lint violations + type errors, or
 * graceful degradation when oxlint is unavailable.
 */

import { resolve } from "node:path";

import type { Diagnostic } from "./pure/types.js";

// ── Types ──

export type DiagnosticsArgs = {
  /** File or directory paths to lint (relative to rootDir). */
  paths: string[];
  /** Workspace root. Defaults to process.cwd(). */
  rootDir?: string;
};

export type DiagnosticsResult = {
  readonly diagnostics: Diagnostic[];
  readonly oxlintAvailable: boolean;
  /** True if some paths were outside workspace root and skipped. */
  readonly pathsSkipped?: string[];
};

// ── Workspace boundary ──

function filterPaths(paths: string[], rootDir: string): { valid: string[]; skipped: string[] } {
  const root = resolve(rootDir);
  const valid: string[] = [];
  const skipped: string[] = [];

  for (const p of paths) {
    const abs = resolve(rootDir, p);
    if (abs.startsWith(root + "/") || abs === root) {
      valid.push(abs);
    } else {
      skipped.push(p);
    }
  }

  return { valid, skipped };
}

// ── Oxlint output parsing ──

type OxlintDiagnostic = {
  filename?: string;
  line?: number;
  column?: number;
  severity?: string;
  message?: string;
  ruleId?: string;
};

function parseOxlintOutput(raw: string): Diagnostic[] {
  try {
    const parsed = JSON.parse(raw) as OxlintDiagnostic[];
    if (!Array.isArray(parsed)) return [];
    return parsed.map((d) => ({
      file: d.filename ?? "",
      line: d.line ?? 0,
      column: d.column ?? 0,
      severity: d.severity ?? "warning",
      message: d.message ?? "",
      ruleId: d.ruleId,
    }));
  } catch {
    return [];
  }
}

// ── Implementation ──

export async function runDiagnostics(args: DiagnosticsArgs): Promise<DiagnosticsResult> {
  const rootDir = args.rootDir ?? process.cwd();
  const { valid, skipped } = filterPaths(args.paths, rootDir);

  if (valid.length === 0) {
    return {
      diagnostics: [],
      oxlintAvailable: true,
      ...(skipped.length > 0 ? { pathsSkipped: skipped } : {}),
    };
  }

  try {
    const proc = Bun.spawn(["oxlint", "--type-aware", "--format", "json", ...valid], {
      cwd: rootDir,
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(proc.stdout).text();
    await proc.exited;

    const diagnostics = parseOxlintOutput(stdout);

    return {
      diagnostics,
      oxlintAvailable: true,
      ...(skipped.length > 0 ? { pathsSkipped: skipped } : {}),
    };
  } catch {
    // oxlint not found or failed to spawn
    return {
      diagnostics: [],
      oxlintAvailable: false,
      ...(skipped.length > 0 ? { pathsSkipped: skipped } : {}),
    };
  }
}
