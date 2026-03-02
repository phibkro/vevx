import { Option } from "effect";

import type { AstPlugin, LspPlugin } from "./Plugin.js";
import type { SymbolRange } from "./pure/AstEdit.js";
import { initRustParser, parseRustSymbols, validateRustSyntax } from "./pure/RustSymbols.js";

// ── Rust AST Plugin ──

/** Create the Rust AST plugin. Initializes tree-sitter WASM on first call. */
export async function makeRustAstPlugin(): Promise<AstPlugin["Type"]> {
  await initRustParser();
  return {
    extensions: new Set([".rs"]),
    parseSymbols: (source, path) => parseRustSymbols(source, path),
    locateSymbol: (source, name, path) => {
      const symbols = parseRustSymbols(source, path);
      const match = symbols.find((s) => s.name === name);
      return Option.fromNullable(match ? (match.range as SymbolRange) : null);
    },
    validateSyntax: (source, _path) => Option.fromNullable(validateRustSyntax(source)),
  };
}

// ── Rust LSP Plugin ──

export const RustLspPluginImpl: LspPlugin["Type"] = {
  extensions: new Set([".rs"]),
  binary: "rust-analyzer",
  args: [],
  languageId: () => "rust",
  initializeParams: () => ({}),
  watchExtensions: new Set([".rs"]),
  watchFilenames: new Set(["Cargo.toml", "Cargo.lock"]),
};
