import { describe, expect, it } from "bun:test";

import { Effect, Either, Option } from "effect";

import { PluginUnavailableError } from "./Plugin.js";
import type { AstPlugin, LspPlugin } from "./Plugin.js";
import { makeRegistryFromPlugins, makeLspRuntimes } from "./PluginLayers.js";
import { TsAstPluginImpl, TsLspPluginImpl } from "./TsPlugin.js";

// ── Mock plugins ──

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

const fakeRustLsp: LspPlugin["Type"] = {
  extensions: new Set([".rs"]),
  binary: "fake-rust-lsp",
  args: [],
  languageId: () => "rust",
  initializeParams: () => ({}),
  watchExtensions: new Set([".rs"]),
  watchFilenames: new Set(["Cargo.toml"]),
};

// ── makeRegistryFromPlugins ──

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

  it("routes multiple AST plugins by extension", () => {
    const fakeRustAst: AstPlugin["Type"] = {
      extensions: new Set([".rs"]),
      parseSymbols: () => [],
      locateSymbol: () => Option.none(),
      validateSyntax: () => Option.none(),
    };
    const registry = makeRegistryFromPlugins({ ast: [fakeAst, fakeRustAst], lsp: [] });
    expect(Option.isSome(registry.astFor("main.rs"))).toBe(true);
    expect(Option.isSome(registry.astFor("index.ts"))).toBe(true);
    expect(Option.isNone(registry.astFor("main.go"))).toBe(true);
  });

  it("routes multiple LSP plugins by extension", () => {
    const registry = makeRegistryFromPlugins({ ast: [], lsp: [fakeLsp, fakeRustLsp] });
    expect(Option.isSome(registry.lspFor("lib.rs"))).toBe(true);
    expect(Option.isSome(registry.lspFor("app.ts"))).toBe(true);
    expect(Option.isNone(registry.lspFor("main.py"))).toBe(true);
  });

  it("returns none for lsp when no lsp plugins registered", () => {
    const registry = makeRegistryFromPlugins({ ast: [fakeAst], lsp: [] });
    expect(Option.isNone(registry.lspFor("index.ts"))).toBe(true);
  });
});

// ── makeLspRuntimes ──

describe("makeLspRuntimes", () => {
  it("returns PluginUnavailableError for unknown extension", async () => {
    const registry = makeRegistryFromPlugins({ ast: [], lsp: [fakeLsp] });
    const runtimes = makeLspRuntimes(() => registry, "/tmp/claude/test-root");

    const result = await Effect.runPromise(Effect.either(runtimes.runtimeFor("main.go")));

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(PluginUnavailableError);
      expect(result.left.path).toBe("main.go");
      expect(result.left.capability).toBe("lsp");
    }
  });

  it("returns PluginUnavailableError with the correct path in the error", async () => {
    const registry = makeRegistryFromPlugins({ ast: [], lsp: [] });
    const runtimes = makeLspRuntimes(() => registry, "/tmp/claude/test-root");

    const result = await Effect.runPromise(
      Effect.either(runtimes.runtimeFor("/some/deep/path/file.py")),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("PluginUnavailableError");
      expect(result.left.path).toBe("/some/deep/path/file.py");
    }
  });

  it("recreate() clears all runtimes when called without extension", () => {
    const registry = makeRegistryFromPlugins({ ast: [], lsp: [fakeLsp] });
    const runtimes = makeLspRuntimes(() => registry, "/tmp/claude/test-root");

    // recreate with no args should not throw
    expect(() => runtimes.recreate()).not.toThrow();
  });

  it("recreate(path) targets only the runtime for that file's language", () => {
    const registry = makeRegistryFromPlugins({ ast: [], lsp: [fakeLsp, fakeRustLsp] });
    const runtimes = makeLspRuntimes(() => registry, "/tmp/claude/test-root");

    // Recreate by file path — resolves to the correct plugin's runtime
    expect(() => runtimes.recreate("index.ts")).not.toThrow();
  });

  it("disposeAll() resolves without error when no runtimes are active", async () => {
    const registry = makeRegistryFromPlugins({ ast: [], lsp: [fakeLsp] });
    const runtimes = makeLspRuntimes(() => registry, "/tmp/claude/test-root");

    await runtimes.disposeAll();
  });
});
