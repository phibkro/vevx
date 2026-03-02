import { Option } from "effect";

import type { AstPlugin, LspPlugin } from "./Plugin.js";
import type { SymbolRange } from "./pure/AstEdit.js";
import { validateSyntax as validateTsSyntax } from "./pure/AstEdit.js";
import { parseSymbols } from "./pure/OxcSymbols.js";

// ── TypeScript AST Plugin ──

export const TsAstPluginImpl: AstPlugin["Type"] = {
  extensions: new Set([".ts", ".tsx"]),
  parseSymbols: (source, path) => parseSymbols(source, path),
  locateSymbol: (source, name, path) => {
    const symbols = parseSymbols(source, path);
    const match = symbols.find((s) => s.name === name);
    return Option.fromNullable(match ? (match.range as SymbolRange) : null);
  },
  validateSyntax: (source, path) => Option.fromNullable(validateTsSyntax(source, path)),
};

// ── TypeScript LSP Plugin ──

export const TsLspPluginImpl: LspPlugin["Type"] = {
  extensions: new Set([".ts", ".tsx"]),
  binary: "typescript-language-server",
  args: ["--stdio"],
  languageId: (path) => (path.endsWith(".tsx") ? "typescriptreact" : "typescript"),
  initializeParams: () => ({}),
  watchExtensions: new Set([".ts", ".tsx"]),
  watchFilenames: new Set(["tsconfig.json", "package.json"]),
};
