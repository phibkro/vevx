/**
 * AST-aware editing primitives for TypeScript/TSX source.
 *
 * Provides symbol location, syntax validation, and byte-range splicing.
 * Pure functions — no LSP or Effect dependency.
 */

import { parseSync } from "oxc-parser";

import { parseSymbols } from "./OxcSymbols.js";

// ── Types ──

export type SymbolRange = { readonly start: number; readonly end: number };

// ── Symbol location ──

/** Locate a top-level symbol by name. Returns byte range or null. */
export function locateSymbol(source: string, name: string, filename: string): SymbolRange | null {
  const symbols = parseSymbols(source, filename);
  const match = symbols.find((s) => s.name === name);
  if (!match) return null;
  return match.range;
}

// ── Validation ──

/** Validate syntax. Returns null if valid, error message string if invalid. */
export function validateSyntax(source: string, filename: string): string | null {
  const lang = filename.endsWith(".tsx") ? "tsx" : "ts";
  const result = parseSync(filename, source, { lang, sourceType: "module" });
  const errors: any[] = (result as any).errors;
  if (errors.length === 0) return null;
  return errors[0].message;
}

// ── Splice operations ──

/** Replace bytes at range with new content. */
export function spliceReplace(file: string, range: SymbolRange, content: string): string {
  return file.slice(0, range.start) + content + file.slice(range.end);
}

/** Insert content after range end. */
export function spliceInsertAfter(file: string, range: SymbolRange, content: string): string {
  return file.slice(0, range.end) + content + file.slice(range.end);
}

/** Insert content before range start. */
export function spliceInsertBefore(file: string, range: SymbolRange, content: string): string {
  return file.slice(0, range.start) + content + file.slice(range.start);
}
