/**
 * Symbol extraction from TypeScript/TSX source using oxc-parser.
 *
 * Parses top-level declarations and produces a flat list of symbols
 * with name, kind, export status, line number, and byte range.
 *
 * Pure function — no LSP or Effect dependency.
 */

import { parseSync } from "oxc-parser";

// ── Types ──

export type OxcSymbol = {
  readonly name: string;
  readonly kind: string;
  readonly exported: boolean;
  readonly line: number;
  readonly range: { readonly start: number; readonly end: number };
};

// ── Node type constants ──

const EXPORT_NAMED = "ExportNamedDeclaration";
const EXPORT_DEFAULT = "ExportDefaultDeclaration";

const DECLARATION_KINDS: Record<string, (node: any) => { name: string; kind: string } | null> = {
  FunctionDeclaration: (n) => ({ name: n.id?.name ?? "<default>", kind: "function" }),
  ClassDeclaration: (n) => ({ name: n.id?.name ?? "<default>", kind: "class" }),
  TSInterfaceDeclaration: (n) => ({ name: n.id.name, kind: "interface" }),
  TSTypeAliasDeclaration: (n) => ({ name: n.id.name, kind: "type" }),
  TSEnumDeclaration: (n) => ({ name: n.id.name, kind: "enum" }),
  VariableDeclaration: (n) => {
    const decl = n.declarations?.[0];
    if (!decl?.id?.name) return null;
    return { name: decl.id.name, kind: n.kind };
  },
};

// ── Core ──

export function parseSymbols(source: string, filename: string): OxcSymbol[] {
  const lang = filename.endsWith(".tsx") ? "tsx" : "ts";
  const result = parseSync(filename, source, { lang, sourceType: "module" });
  const body: any[] = (result as any).program.body;
  const lineOffsets = buildLineOffsets(source);
  const symbols: OxcSymbol[] = [];

  for (const node of body) {
    if (node.type === EXPORT_NAMED || node.type === EXPORT_DEFAULT) {
      const decl = node.declaration;
      if (!decl) continue;

      const info = extractInfo(decl);
      if (!info) continue;

      symbols.push({
        name: info.name,
        kind: info.kind,
        exported: true,
        line: lineFromOffset(lineOffsets, node.start),
        range: { start: node.start, end: node.end },
      });
    } else {
      const info = extractInfo(node);
      if (!info) continue;

      symbols.push({
        name: info.name,
        kind: info.kind,
        exported: false,
        line: lineFromOffset(lineOffsets, node.start),
        range: { start: node.start, end: node.end },
      });
    }
  }

  return symbols;
}

/** Build an array of byte offsets where each line starts. */
function buildLineOffsets(source: string): number[] {
  const offsets = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "\n") offsets.push(i + 1);
  }
  return offsets;
}

/** Convert a byte offset to a 1-based line number. */
function lineFromOffset(offsets: number[], offset: number): number {
  let lo = 0;
  let hi = offsets.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (offsets[mid] <= offset) lo = mid + 1;
    else hi = mid - 1;
  }
  return lo; // 1-based: first line = 1
}

function extractInfo(node: any): { name: string; kind: string } | null {
  const extractor = DECLARATION_KINDS[node.type];
  if (!extractor) return null;
  return extractor(node);
}
