import { describe, expect, it } from "bun:test";

import { Option } from "effect";

import { makeRegistry, PluginUnavailableError } from "./Plugin.js";
import type { AstPlugin, LspPlugin } from "./Plugin.js";

const fakeAst: AstPlugin["Type"] = {
  extensions: new Set([".ts", ".tsx"]),
  parseSymbols: () => [],
  locateSymbol: () => Option.none(),
  validateSyntax: () => Option.none(),
};

const fakeLsp: LspPlugin["Type"] = {
  extensions: new Set([".ts", ".tsx"]),
  binary: "fake-lsp",
  args: [],
  languageId: (path) => (path.endsWith(".tsx") ? "typescriptreact" : "typescript"),
  initializeParams: () => ({}),
  watchExtensions: new Set([".ts", ".tsx"]),
  watchFilenames: new Set(["tsconfig.json"]),
};

describe("makeRegistry", () => {
  const registry = makeRegistry([fakeAst], [fakeLsp]);

  it("returns ast plugin for registered extension", () => {
    const result = registry.astFor("foo.ts");
    expect(Option.isSome(result)).toBe(true);
  });

  it("returns none for unregistered extension", () => {
    const result = registry.astFor("foo.go");
    expect(Option.isNone(result)).toBe(true);
  });

  it("returns lsp plugin for registered extension", () => {
    const result = registry.lspFor("foo.tsx");
    expect(Option.isSome(result)).toBe(true);
  });

  it("returns none for unregistered lsp extension", () => {
    const result = registry.lspFor("foo.py");
    expect(Option.isNone(result)).toBe(true);
  });
});

describe("PluginUnavailableError", () => {
  it("has correct tag and fields", () => {
    const err = new PluginUnavailableError({ path: "foo.go", capability: "ast" });
    expect(err._tag).toBe("PluginUnavailableError");
    expect(err.path).toBe("foo.go");
    expect(err.capability).toBe("ast");
  });
});
