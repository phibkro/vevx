/**
 * Edit pipeline: read → locate → validate → splice → write → lint.
 *
 * Stateless async module — no Effect or LSP dependency.
 * Provides file-level symbol editing with syntax validation and
 * best-effort oxlint diagnostics.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  locateSymbol,
  spliceInsertAfter,
  spliceInsertBefore,
  spliceReplace,
  validateSyntax,
} from "./pure/AstEdit.js";

// ── Types ──

export type Diagnostic = {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly severity: string;
  readonly message: string;
  readonly ruleId?: string;
};

export type EditResult = {
  readonly success: boolean;
  readonly path: string;
  readonly symbol: string;
  readonly diagnostics: Diagnostic[];
  readonly syntaxError: boolean;
  readonly syntaxErrorMessage?: string;
};

// ── Oxlint ──

function parseOxlintOutput(raw: string, filePath: string): Diagnostic[] {
  try {
    const parsed = JSON.parse(raw) as {
      line?: number;
      column?: number;
      severity?: string;
      message?: string;
      ruleId?: string;
    }[];
    if (!Array.isArray(parsed)) return [];
    return parsed.map((d) => ({
      file: filePath,
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

async function runOxlint(filePath: string): Promise<Diagnostic[]> {
  try {
    const proc = Bun.spawn(["oxlint", "--format", "json", filePath], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;
    return parseOxlintOutput(stdout, filePath);
  } catch {
    return [];
  }
}

// ── Workspace boundary ──

function assertWithinRoot(filePath: string, rootDir: string): string | null {
  const resolved = resolve(filePath);
  const root = resolve(rootDir);
  if (!resolved.startsWith(root + "/") && resolved !== root) {
    return `Path "${filePath}" is outside workspace root`;
  }
  return null;
}

// ── Core edit pipeline ──

type SpliceOp = "replace" | "insertAfter" | "insertBefore";

async function edit(
  filePath: string,
  symbolName: string,
  content: string,
  op: SpliceOp,
  rootDir?: string,
): Promise<EditResult> {
  // Workspace boundary check
  if (rootDir) {
    const boundaryError = assertWithinRoot(filePath, rootDir);
    if (boundaryError) {
      return {
        success: false,
        path: filePath,
        symbol: symbolName,
        diagnostics: [],
        syntaxError: false,
        syntaxErrorMessage: boundaryError,
      };
    }
  }

  const filename = filePath.split("/").pop() ?? "file.ts";

  // Read
  let source: string;
  try {
    source = readFileSync(filePath, "utf-8");
  } catch (e) {
    return {
      success: false,
      path: filePath,
      symbol: symbolName,
      diagnostics: [],
      syntaxError: false,
      syntaxErrorMessage: `Failed to read file: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  // Locate
  const range = locateSymbol(source, symbolName, filename);
  if (!range) {
    return {
      success: false,
      path: filePath,
      symbol: symbolName,
      diagnostics: [],
      syntaxError: false,
      syntaxErrorMessage: `Symbol "${symbolName}" not found in ${filename}`,
    };
  }

  // For replace: validate the new content fragment syntax
  if (op === "replace") {
    const contentError = validateSyntax(content, filename);
    if (contentError) {
      return {
        success: false,
        path: filePath,
        symbol: symbolName,
        diagnostics: [],
        syntaxError: true,
        syntaxErrorMessage: `New content has syntax error: ${contentError}`,
      };
    }
  }

  // Splice
  const spliceFn =
    op === "replace"
      ? spliceReplace
      : op === "insertAfter"
        ? spliceInsertAfter
        : spliceInsertBefore;
  const result = spliceFn(source, range, content);

  // Validate full file after edit
  const fullFileError = validateSyntax(result, filename);
  if (fullFileError) {
    return {
      success: false,
      path: filePath,
      symbol: symbolName,
      diagnostics: [],
      syntaxError: true,
      syntaxErrorMessage: `Edited file has syntax error: ${fullFileError}`,
    };
  }

  // Write
  writeFileSync(filePath, result);

  // Lint (best effort)
  const diagnostics = await runOxlint(filePath);

  return {
    success: true,
    path: filePath,
    symbol: symbolName,
    diagnostics,
    syntaxError: false,
  };
}

// ── Public API ──

export async function editReplace(
  filePath: string,
  symbolName: string,
  content: string,
  rootDir?: string,
): Promise<EditResult> {
  return edit(filePath, symbolName, content, "replace", rootDir);
}

export async function editInsertAfter(
  filePath: string,
  symbolName: string,
  content: string,
  rootDir?: string,
): Promise<EditResult> {
  return edit(filePath, symbolName, content, "insertAfter", rootDir);
}

export async function editInsertBefore(
  filePath: string,
  symbolName: string,
  content: string,
  rootDir?: string,
): Promise<EditResult> {
  return edit(filePath, symbolName, content, "insertBefore", rootDir);
}
