import { describe, expect, it } from "bun:test";

import { Option } from "effect";

import { TsAstPluginImpl, TsLspPluginImpl } from "./TsPlugin.js";

describe("TsAstPluginImpl", () => {
  it("handles .ts and .tsx extensions", () => {
    expect(TsAstPluginImpl.extensions.has(".ts")).toBe(true);
    expect(TsAstPluginImpl.extensions.has(".tsx")).toBe(true);
    expect(TsAstPluginImpl.extensions.has(".rs")).toBe(false);
  });

  it("parses TypeScript symbols", () => {
    const symbols = TsAstPluginImpl.parseSymbols("export const x = 1;", "test.ts");
    expect(symbols.length).toBe(1);
    expect(symbols[0].name).toBe("x");
    expect(symbols[0].exported).toBe(true);
  });

  it("locates a symbol by name", () => {
    const result = TsAstPluginImpl.locateSymbol("export const x = 1;", "x", "test.ts");
    expect(Option.isSome(result)).toBe(true);
  });

  it("returns none for missing symbol", () => {
    const result = TsAstPluginImpl.locateSymbol("export const x = 1;", "y", "test.ts");
    expect(Option.isNone(result)).toBe(true);
  });

  it("validates syntax — valid", () => {
    const result = TsAstPluginImpl.validateSyntax("const x = 1;", "test.ts");
    expect(Option.isNone(result)).toBe(true);
  });

  it("validates syntax — invalid", () => {
    const result = TsAstPluginImpl.validateSyntax("const = ;", "test.ts");
    expect(Option.isSome(result)).toBe(true);
  });
});

describe("TsLspPluginImpl", () => {
  it("handles .ts and .tsx extensions", () => {
    expect(TsLspPluginImpl.extensions.has(".ts")).toBe(true);
    expect(TsLspPluginImpl.extensions.has(".tsx")).toBe(true);
  });

  it("returns correct languageId", () => {
    expect(TsLspPluginImpl.languageId("foo.ts")).toBe("typescript");
    expect(TsLspPluginImpl.languageId("foo.tsx")).toBe("typescriptreact");
  });
});
