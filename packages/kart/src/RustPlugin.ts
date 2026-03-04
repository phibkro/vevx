import { RustGrammar, RustHooks } from "./core/RustGrammar.js";
import { makeTreeSitterPlugin } from "./core/TreeSitterPlugin.js";
import type { LspPlugin } from "./Plugin.js";

export { RustGrammar, RustHooks } from "./core/RustGrammar.js";

// ── Rust AST Plugin ──

/** Create the Rust AST plugin. Initializes tree-sitter WASM on first call. */
export const makeRustAstPlugin = () =>
  makeTreeSitterPlugin(new Set([".rs"]), RustGrammar, RustHooks);

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
