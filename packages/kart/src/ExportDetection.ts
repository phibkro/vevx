/**
 * Export detection for TypeScript symbols.
 *
 * ## Strategy: Text scanning (chosen over semantic tokens)
 *
 * The LSP semantic token protocol defines these modifiers:
 *   declaration, definition, readonly, static, deprecated, abstract,
 *   async, modification, documentation, defaultLibrary
 *
 * Notably, "exported" is NOT among them. The typescript-language-server
 * does not add custom modifiers either — it uses the standard LSP set.
 * This was validated empirically: exported and non-exported symbols
 * receive identical modifier bitmasks (typically just "declaration").
 *
 * Text scanning is reliable because TypeScript export syntax is
 * unambiguous and always appears at the start of a declaration line:
 *   - `export function`, `export const`, `export class`, etc.
 *   - `export default function`, `export default class`
 *   - `export { ... }` (re-exports — these don't appear as documentSymbol)
 *
 * The only edge case is multi-line declarations where `export` is on a
 * different line than the symbol name. In practice, TypeScript formatters
 * (including oxfmt) keep `export` on the same line as the declaration
 * keyword, so this is not a concern for well-formatted code.
 */

import type { DocumentSymbol } from "./Lsp.js";

/**
 * Determine whether a symbol from `textDocument/documentSymbol` is exported,
 * by scanning the source text at the symbol's declaration line.
 *
 * Pure function — no LSP or Effect dependency.
 *
 * @param lines - Pre-split file content (`fileContent.split("\n")`). Caller
 *   should split once and pass the array to avoid redundant work per symbol.
 */
export function isExported(symbol: DocumentSymbol, lines: readonly string[]): boolean {
  const lineIndex = symbol.range.start.line;

  if (lineIndex < 0 || lineIndex >= lines.length) return false;

  const line = lines[lineIndex].trimStart();
  return line.startsWith("export ");
}
