import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

import { Context, Effect, Layer } from "effect";

import { isExported } from "./ExportDetection.js";
import { FileNotFoundError, LspError, LspTimeoutError } from "./Errors.js";
import type { DocumentSymbol } from "./Lsp.js";
import { LspClient } from "./Lsp.js";

// ── Types ──

export type ZoomSymbol = {
  readonly name: string;
  readonly kind: string;
  readonly signature: string;
  readonly doc: string | null;
  readonly exported: boolean;
  readonly children?: ZoomSymbol[];
};

export type ZoomResult = {
  readonly path: string;
  readonly level: 0 | 1 | 2;
  readonly symbols: ZoomSymbol[];
  /**
   * Whether implementation bodies were omitted from signatures.
   * true for levels 0 and 1 (signatures only), false for level 2 (full content).
   */
  readonly truncated: boolean;
  readonly files?: ZoomResult[];
};

// ── SymbolKind mapping ──

const SYMBOL_KIND_MAP: Record<number, string> = {
  1: "file",
  2: "module",
  3: "namespace",
  4: "package",
  5: "class",
  6: "method",
  7: "property",
  8: "field",
  9: "constructor",
  10: "enum",
  11: "interface",
  12: "function",
  13: "variable",
  14: "constant",
  15: "string",
  16: "number",
  17: "boolean",
  18: "array",
  19: "object",
  20: "key",
  21: "null",
  22: "enumMember",
  23: "struct",
  24: "event",
  25: "operator",
  26: "type",
};

function symbolKindName(kind: number): string {
  return SYMBOL_KIND_MAP[kind] ?? "unknown";
}

// ── Signature extraction ──

/**
 * Extract the declaration signature from source text for a given symbol range.
 * Captures from the start of the symbol's range to the first `{` that opens
 * a body block, or the end of the statement for bodyless declarations.
 */
export function extractSignature(symbol: DocumentSymbol, lines: string[]): string {
  const startLine = symbol.range.start.line;
  const endLine = symbol.range.end.line;

  if (startLine < 0 || startLine >= lines.length) return symbol.name;

  // Collect lines from start to end of symbol, looking for the body opener
  const collected: string[] = [];

  for (let i = startLine; i <= Math.min(endLine, lines.length - 1); i++) {
    const line = lines[i];
    collected.push(line);

    // Check if this line contains an opening brace that starts a body
    const braceIdx = findBodyOpenBrace(line);
    if (braceIdx !== -1) {
      // Trim everything from the opening brace onward
      const lastLine = collected[collected.length - 1];
      const trimmed = lastLine.slice(0, braceIdx).trimEnd();
      collected[collected.length - 1] = trimmed;
      break;
    }

    // For single-line declarations (type aliases, const without body), stop at semicolon
    if (line.trimEnd().endsWith(";")) break;
  }

  return collected.join("\n").trimEnd();
}

/**
 * Find the index of a `{` that opens a body block (not a type literal).
 * Returns -1 if no body-opening brace found on this line.
 */
function findBodyOpenBrace(line: string): number {
  // Track nesting of parens and angle brackets to skip braces inside types
  let parenDepth = 0;
  let angleDepth = 0;
  let inString: string | null = null;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    // Skip string literals
    if (inString) {
      if (ch === inString && line[i - 1] !== "\\") inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch;
      continue;
    }

    if (ch === "(") parenDepth++;
    else if (ch === ")" && parenDepth > 0) parenDepth--;
    else if (ch === "<") angleDepth++;
    else if (ch === ">" && angleDepth > 0) angleDepth--;
    else if (ch === "{" && parenDepth === 0 && angleDepth === 0) {
      return i;
    }
  }

  return -1;
}

// ── Doc comment extraction ──

/**
 * Extract a JSDoc/TSDoc comment block that immediately precedes a symbol.
 * Scans backwards from the symbol's start line looking for a comment block.
 */
export function extractDocComment(symbol: DocumentSymbol, lines: string[]): string | null {
  const startLine = symbol.range.start.line;

  // Look at the line just above the symbol
  let endCommentLine = startLine - 1;

  // Skip blank lines and decorator lines between symbol and doc comment
  while (endCommentLine >= 0) {
    const trimmed = lines[endCommentLine].trim();
    if (trimmed === "" || trimmed.startsWith("@")) {
      endCommentLine--;
      continue;
    }
    break;
  }

  if (endCommentLine < 0) return null;

  // Check if this line ends a doc comment
  if (!lines[endCommentLine].trim().endsWith("*/")) return null;

  // Scan upward to find the opening /**
  let startCommentLine = endCommentLine;
  while (startCommentLine >= 0) {
    if (lines[startCommentLine].includes("/**")) break;
    startCommentLine--;
  }

  if (startCommentLine < 0) return null;

  const commentLines = lines.slice(startCommentLine, endCommentLine + 1);
  return commentLines.join("\n");
}

// ── Symbol conversion ──

function toZoomSymbol(
  symbol: DocumentSymbol,
  lines: string[],
): ZoomSymbol {
  const kind = symbolKindName(symbol.kind);
  const signature = extractSignature(symbol, lines);
  const doc = extractDocComment(symbol, lines);
  const exported = isExported(symbol, lines);

  const children =
    symbol.children && symbol.children.length > 0
      ? symbol.children.map((c) => toZoomSymbol(c, lines))
      : undefined;

  return { name: symbol.name, kind, signature, doc, exported, ...(children ? { children } : {}) };
}

// ── Service ──

export class SymbolIndex extends Context.Tag("kart/SymbolIndex")<
  SymbolIndex,
  {
    readonly zoom: (
      path: string,
      level: 0 | 1 | 2,
    ) => Effect.Effect<ZoomResult, LspError | LspTimeoutError | FileNotFoundError>;
  }
>() {}

// ── Layer ──

export const SymbolIndexLive: Layer.Layer<SymbolIndex, never, LspClient> = Layer.effect(
  SymbolIndex,
  Effect.gen(function* () {
    const lsp = yield* LspClient;

    return SymbolIndex.of({
      zoom: (path, level) =>
        Effect.gen(function* () {
          const absPath = resolve(path);

          // Check existence
          if (!existsSync(absPath)) {
            return yield* Effect.fail(new FileNotFoundError({ path: absPath }));
          }

          // Directory zoom
          const stat = statSync(absPath);
          if (stat.isDirectory()) {
            return yield* zoomDirectory(lsp, absPath);
          }

          // Level 2: full file content
          if (level === 2) {
            const content = readFileSync(absPath, "utf-8");
            return {
              path: absPath,
              level: 2 as const,
              symbols: [
                {
                  name: absPath.split("/").pop() ?? absPath,
                  kind: "file",
                  signature: content,
                  doc: null,
                  exported: false,
                },
              ],
              truncated: false,
            };
          }

          // Level 0 or 1: use LSP
          const uri = `file://${absPath}`;
          const symbols = yield* lsp.documentSymbol(uri);
          const fileContent = readFileSync(absPath, "utf-8");
          const lines = fileContent.split("\n");

          let zoomSymbols = symbols.map((s) => toZoomSymbol(s, lines));

          // Level 0: filter to exported only
          if (level === 0) {
            zoomSymbols = zoomSymbols.filter((s) => s.exported);
          }

          return {
            path: absPath,
            level,
            symbols: zoomSymbols,
            truncated: true,
          };
        }),
    });
  }),
);

// ── Directory zoom helper ──

function zoomDirectory(
  lsp: Context.Tag.Service<typeof LspClient>,
  dirPath: string,
): Effect.Effect<ZoomResult, LspError | LspTimeoutError | FileNotFoundError> {
  return Effect.gen(function* () {
    const entries = readdirSync(dirPath);
    const tsFiles = entries
      .filter((e) => e.endsWith(".ts") || e.endsWith(".tsx"))
      .filter((e) => !e.endsWith(".test.ts") && !e.endsWith(".test.tsx"))
      .sort();

    const fileResults: ZoomResult[] = [];

    for (const file of tsFiles) {
      const filePath = resolve(dirPath, file);
      const uri = `file://${filePath}`;
      const fileContent = readFileSync(filePath, "utf-8");
      const lines = fileContent.split("\n");

      const symbols = yield* lsp.documentSymbol(uri);
      const zoomSymbols = symbols
        .map((s) => toZoomSymbol(s, lines))
        .filter((s) => s.exported);

      // Omit files with no exports
      if (zoomSymbols.length === 0) continue;

      fileResults.push({
        path: filePath,
        level: 0,
        symbols: zoomSymbols,
        truncated: true,
      });
    }

    return {
      path: dirPath,
      level: 0 as const,
      symbols: [],
      truncated: true,
      files: fileResults,
    };
  });
}
