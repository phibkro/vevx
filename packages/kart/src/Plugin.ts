import { extname } from "node:path";

import { Context, Data, Option } from "effect";

import type { SymbolRange } from "./pure/AstEdit.js";
import type { OxcSymbol } from "./pure/OxcSymbols.js";

// ── Plugin interfaces ──

export class LspPlugin extends Context.Tag("kart/LspPlugin")<
  LspPlugin,
  {
    readonly extensions: ReadonlySet<string>;
    readonly binary: string;
    readonly args: readonly string[];
    readonly languageId: (path: string) => string;
    readonly initializeParams: (root: string) => Record<string, unknown>;
    readonly watchExtensions: ReadonlySet<string>;
    readonly watchFilenames: ReadonlySet<string>;
  }
>() {}

export class AstPlugin extends Context.Tag("kart/AstPlugin")<
  AstPlugin,
  {
    readonly extensions: ReadonlySet<string>;
    readonly parseSymbols: (source: string, path: string) => OxcSymbol[];
    readonly locateSymbol: (
      source: string,
      name: string,
      path: string,
    ) => Option.Option<SymbolRange>;
    readonly validateSyntax: (source: string, path: string) => Option.Option<string>;
  }
>() {}

// ── Plugin registry ──

export class PluginRegistry extends Context.Tag("kart/PluginRegistry")<
  PluginRegistry,
  {
    readonly astFor: (path: string) => Option.Option<AstPlugin["Type"]>;
    readonly lspFor: (path: string) => Option.Option<LspPlugin["Type"]>;
    readonly allLspPlugins: () => LspPlugin["Type"][];
  }
>() {}

export const makeRegistry = (
  astPlugins: AstPlugin["Type"][],
  lspPlugins: LspPlugin["Type"][],
): PluginRegistry["Type"] => {
  const astMap = new Map(astPlugins.flatMap((p) => [...p.extensions].map((ext) => [ext, p])));
  const lspMap = new Map(lspPlugins.flatMap((p) => [...p.extensions].map((ext) => [ext, p])));
  // Deduplicate by binary — multiple extensions can share one plugin instance
  const uniqueLspPlugins = [...new Map(lspPlugins.map((p) => [p.binary, p])).values()];
  return {
    astFor: (path) => Option.fromNullable(astMap.get(extname(path))),
    lspFor: (path) => Option.fromNullable(lspMap.get(extname(path))),
    allLspPlugins: () => uniqueLspPlugins,
  };
};

// ── Errors ──

export class PluginUnavailableError extends Data.TaggedError("PluginUnavailableError")<{
  readonly path: string;
  readonly capability: "lsp" | "ast";
}> {}
