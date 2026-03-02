import { describe, expect, it } from "bun:test";
import { Option } from "effect";

import { makeRegistryFromPlugins } from "./PluginLayers.js";
import { TsAstPluginImpl, TsLspPluginImpl } from "./TsPlugin.js";

describe("makeRegistryFromPlugins", () => {
  it("routes .ts to TypeScript AST plugin", () => {
    const registry = makeRegistryFromPlugins({ ast: [TsAstPluginImpl], lsp: [TsLspPluginImpl] });
    const plugin = registry.astFor("test.ts");
    expect(Option.isSome(plugin)).toBe(true);
  });

  it("returns none for unknown extension", () => {
    const registry = makeRegistryFromPlugins({ ast: [TsAstPluginImpl], lsp: [TsLspPluginImpl] });
    const plugin = registry.astFor("test.go");
    expect(Option.isNone(plugin)).toBe(true);
  });

  it("routes .ts to TypeScript LSP plugin", () => {
    const registry = makeRegistryFromPlugins({ ast: [TsAstPluginImpl], lsp: [TsLspPluginImpl] });
    const plugin = registry.lspFor("test.ts");
    expect(Option.isSome(plugin)).toBe(true);
  });
});
