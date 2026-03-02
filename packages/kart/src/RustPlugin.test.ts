import { describe, expect, it } from "bun:test";

import { Option } from "effect";

import { RustLspPluginImpl, makeRustAstPlugin } from "./RustPlugin.js";

describe("RustLspPluginImpl", () => {
  it("handles .rs extension", () => {
    expect(RustLspPluginImpl.extensions.has(".rs")).toBe(true);
    expect(RustLspPluginImpl.extensions.has(".ts")).toBe(false);
  });

  it("returns rust languageId", () => {
    expect(RustLspPluginImpl.languageId("foo.rs")).toBe("rust");
  });

  it("returns empty initializeParams", () => {
    expect(RustLspPluginImpl.initializeParams()).toEqual({});
  });
});

describe("makeRustAstPlugin", () => {
  it("handles .rs extension after init", async () => {
    const plugin = await makeRustAstPlugin();
    expect(plugin.extensions.has(".rs")).toBe(true);
  });

  it("parses Rust symbols", async () => {
    const plugin = await makeRustAstPlugin();
    const symbols = plugin.parseSymbols("pub fn hello() {}", "test.rs");
    expect(symbols.length).toBeGreaterThan(0);
    expect(symbols[0].name).toBe("hello");
  });

  it("locateSymbol returns range for existing symbol", async () => {
    const plugin = await makeRustAstPlugin();
    const source = "pub fn greet() {}\npub fn farewell() {}";
    const result = plugin.locateSymbol(source, "greet", "test.rs");
    expect(Option.isSome(result)).toBe(true);
    if (Option.isSome(result)) {
      expect(result.value.start).toBe(0);
      expect(result.value.end).toBeGreaterThan(0);
    }
  });

  it("locateSymbol returns none for missing symbol", async () => {
    const plugin = await makeRustAstPlugin();
    const result = plugin.locateSymbol("pub fn greet() {}", "nonexistent", "test.rs");
    expect(Option.isNone(result)).toBe(true);
  });

  it("validateSyntax returns none for valid Rust", async () => {
    const plugin = await makeRustAstPlugin();
    const result = plugin.validateSyntax("pub fn greet() {}", "test.rs");
    expect(Option.isNone(result)).toBe(true);
  });

  it("validateSyntax returns error for invalid Rust", async () => {
    const plugin = await makeRustAstPlugin();
    const result = plugin.validateSyntax("pub fn greet( {{{", "test.rs");
    expect(Option.isSome(result)).toBe(true);
  });
});
