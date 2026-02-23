/**
 * Workspace diagnostics via oxlint --type-aware (TS) and cargo clippy (Rust).
 *
 * Stateless async module — no Effect or LSP dependency.
 * Returns structured lint violations + type errors, or
 * graceful degradation when tools are unavailable.
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
  readonly clippyAvailable?: boolean;
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

// ── Clippy output parsing ──

type ClippyMessage = {
  reason?: string;
  message?: {
    level?: string;
    message?: string;
    code?: { code?: string } | null;
    spans?: { file_name?: string; line_start?: number; column_start?: number }[];
  };
};

function parseClippyOutput(raw: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line) as ClippyMessage;
      if (msg.reason !== "compiler-message" || !msg.message) continue;
      const m = msg.message;
      if (m.level === "note" || m.level === "help") continue;
      const span = m.spans?.[0];
      diagnostics.push({
        file: span?.file_name ?? "",
        line: span?.line_start ?? 0,
        column: span?.column_start ?? 0,
        severity: m.level === "error" ? "error" : "warning",
        message: m.message ?? "",
        ruleId: m.code?.code ?? undefined,
      });
    } catch {
      // skip non-JSON lines
    }
  }
  return diagnostics;
}

// ── Path splitting ──

function splitByLanguage(paths: string[]): { ts: string[]; rs: string[] } {
  const ts: string[] = [];
  const rs: string[] = [];
  for (const p of paths) {
    if (p.endsWith(".rs")) rs.push(p);
    else ts.push(p);
  }
  return { ts, rs };
}

// ── Runners ──

async function runOxlint(
  paths: string[],
  rootDir: string,
): Promise<{ diagnostics: Diagnostic[]; available: boolean }> {
  try {
    const proc = Bun.spawn(["oxlint", "--type-aware", "--format", "json", ...paths], {
      cwd: rootDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;
    return { diagnostics: parseOxlintOutput(stdout), available: true };
  } catch {
    return { diagnostics: [], available: false };
  }
}

async function runClippy(
  paths: string[],
  rootDir: string,
): Promise<{ diagnostics: Diagnostic[]; available: boolean }> {
  try {
    const proc = Bun.spawn(
      [
        "cargo",
        "clippy",
        "--message-format",
        "json",
        "--quiet",
        "--",
        ...paths.map((p) => `--file=${p}`),
      ],
      { cwd: rootDir, stdout: "pipe", stderr: "pipe" },
    );
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;
    return { diagnostics: parseClippyOutput(stdout), available: true };
  } catch {
    return { diagnostics: [], available: false };
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

  const { ts, rs } = splitByLanguage(valid);
  const results: Diagnostic[] = [];
  let oxlintAvailable = true;
  let clippyAvailable: boolean | undefined;

  if (ts.length > 0) {
    const oxResult = await runOxlint(ts, rootDir);
    oxlintAvailable = oxResult.available;
    results.push(...oxResult.diagnostics);
  }

  if (rs.length > 0) {
    const clipResult = await runClippy(rs, rootDir);
    clippyAvailable = clipResult.available;
    results.push(...clipResult.diagnostics);
  }

  return {
    diagnostics: results,
    oxlintAvailable,
    ...(clippyAvailable !== undefined ? { clippyAvailable } : {}),
    ...(skipped.length > 0 ? { pathsSkipped: skipped } : {}),
  };
}
