/**
 * Symbol extraction from Rust source using tree-sitter.
 *
 * Parses top-level declarations and produces a flat list of symbols
 * with name, kind, export status, line number, and byte range.
 *
 * Returns the same OxcSymbol shape as the TypeScript extractor.
 */

import { resolve } from "node:path";

import type Parser from "web-tree-sitter";

import type { OxcSymbol } from "./OxcSymbols.js";

// Re-export for convenience
export type { OxcSymbol } from "./OxcSymbols.js";

// ── Parser state ──

let rustParser: Parser | null = null;

// ── Node type → kind mapping ──

const NODE_KINDS: Record<string, string> = {
  function_item: "function",
  struct_item: "struct",
  enum_item: "enum",
  trait_item: "trait",
  impl_item: "impl",
  type_item: "type",
  const_item: "const",
  static_item: "static",
  mod_item: "mod",
  macro_definition: "macro",
};

// ── Lifecycle ──

export async function initRustParser(): Promise<void> {
  if (rustParser) return;

  const TreeSitter = (await import("web-tree-sitter")).default;
  await TreeSitter.init();

  const wasmPath = resolve(
    import.meta.dir,
    "../../node_modules/tree-sitter-wasms/out/tree-sitter-rust.wasm",
  );
  const lang = await TreeSitter.Language.load(wasmPath);

  const parser = new TreeSitter();
  parser.setLanguage(lang);
  rustParser = parser;
}

export function isRustParserReady(): boolean {
  return rustParser !== null;
}

// ── Core ──

export function parseRustSymbols(source: string, _filename: string): OxcSymbol[] {
  if (!rustParser) {
    throw new Error("Rust parser not initialized — call initRustParser() first");
  }

  if (source.length === 0) return [];

  const tree = rustParser.parse(source);
  const symbols: OxcSymbol[] = [];

  for (const node of tree.rootNode.children) {
    const kind = NODE_KINDS[node.type];
    if (!kind) continue;

    const name = extractName(node);
    if (!name) continue;

    const exported = hasVisibilityModifier(node);

    symbols.push({
      name,
      kind,
      exported,
      line: node.startPosition.row + 1,
      range: { start: node.startIndex, end: node.endIndex },
    });
  }

  return symbols;
}

// ── Helpers ──

function extractName(node: Parser.SyntaxNode): string | null {
  // macro_definition: first identifier child
  if (node.type === "macro_definition") {
    for (const child of node.children) {
      if (child.type === "identifier") return child.text;
    }
    return null;
  }

  // impl_item: build "Type" or "Trait for Type" from relevant children
  if (node.type === "impl_item") {
    return buildImplName(node);
  }

  // Everything else: use the "name" field
  return node.childForFieldName("name")?.text ?? null;
}

const IMPL_SKIP_TYPES = new Set([
  "visibility_modifier",
  "declaration_list",
  "type_parameters",
  "where_clause",
]);

function buildImplName(node: Parser.SyntaxNode): string {
  const parts: string[] = [];
  for (const child of node.children) {
    if (child.type === "impl" || IMPL_SKIP_TYPES.has(child.type)) continue;
    parts.push(child.text);
  }
  return parts.join(" ");
}

function hasVisibilityModifier(node: Parser.SyntaxNode): boolean {
  for (const child of node.children) {
    if (child.type === "visibility_modifier") return true;
  }
  return false;
}
