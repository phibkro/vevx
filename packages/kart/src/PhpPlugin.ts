import type { LspPlugin } from "./Plugin.js";
import { makeTreeSitterPlugin, type TreeSitterGrammar } from "./pure/TreeSitterPlugin.js";

// ── PHP grammar ──

export const PhpGrammar: TreeSitterGrammar = {
  language: "PHP",
  wasmFile: "tree-sitter-php.wasm",
  symbolQuery: `
    (function_definition name: (name) @name) @definition.function
    (class_declaration name: (name) @name) @definition.class
    (interface_declaration name: (name) @name) @definition.interface
    (trait_declaration name: (name) @name) @definition.trait
    (enum_declaration name: (name) @name) @definition.enum
  `,
};

// ── PHP AST Plugin ──

/** Create the PHP AST plugin. Initializes tree-sitter WASM on first call. */
export const makePhpAstPlugin = () => makeTreeSitterPlugin(new Set([".php"]), PhpGrammar);

// ── PHP LSP Plugin ──

export const PhpLspPluginImpl: LspPlugin["Type"] = {
  extensions: new Set([".php"]),
  binary: "intelephense",
  args: ["--stdio"],
  languageId: () => "php",
  initializeParams: () => ({}),
  watchExtensions: new Set([".php"]),
  watchFilenames: new Set(["composer.json", "composer.lock"]),
};
