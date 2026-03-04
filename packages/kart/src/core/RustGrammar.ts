/**
 * Rust tree-sitter grammar config and hooks.
 *
 * Plain data objects — no Effect or IO dependencies.
 * Used by both the pure layer (RustImports, RustSymbols) and the
 * effectful layer (RustPlugin).
 */

import type Parser from "web-tree-sitter";

import type { TreeSitterGrammar, TreeSitterHooks } from "./TreeSitterPlugin.js";

// ── Rust grammar ──

export const RustGrammar: TreeSitterGrammar = {
  language: "Rust",
  wasmFile: "tree-sitter-rust.wasm",
  symbolQuery: `
    (function_item name: (identifier) @name) @definition.function
    (struct_item name: (type_identifier) @name) @definition.struct
    (enum_item name: (type_identifier) @name) @definition.enum
    (trait_item name: (type_identifier) @name) @definition.trait
    (impl_item) @definition.impl
    (type_item name: (type_identifier) @name) @definition.type
    (const_item name: (identifier) @name) @definition.const
    (static_item name: (identifier) @name) @definition.static
    (mod_item name: (identifier) @name) @definition.mod
    (macro_definition name: (identifier) @name) @definition.macro
  `,
};

// ── Rust-specific hooks ──

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

export const RustHooks: TreeSitterHooks = {
  extractName: (node, captures) => {
    if (node.type === "impl_item") return buildImplName(node);
    const nameCapture = captures.find((c) => c.name === "name");
    return nameCapture?.node.text ?? null;
  },
  isExported: hasVisibilityModifier,
};
