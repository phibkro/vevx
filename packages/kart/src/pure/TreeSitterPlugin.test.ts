import { describe, expect, test } from "bun:test";

import { Option } from "effect";

import { RustGrammar, RustHooks } from "../RustPlugin.js";
import {
  extractSymbols,
  initTreeSitterParser,
  isParserReady,
  makeTreeSitterPlugin,
  validateTreeSitterSyntax,
} from "./TreeSitterPlugin.js";

// Use Rust grammar as a real-world test case for the generic factory.

describe("initTreeSitterParser", () => {
  test("loads parser and query for a grammar", async () => {
    const { parser, query } = await initTreeSitterParser(RustGrammar);
    expect(parser).toBeDefined();
    expect(query).toBeDefined();
  });

  test("returns cached parser on second call", async () => {
    const first = await initTreeSitterParser(RustGrammar);
    const second = await initTreeSitterParser(RustGrammar);
    expect(first.parser).toBe(second.parser);
    expect(first.query).toBe(second.query);
  });
});

describe("isParserReady", () => {
  test("returns true after init", async () => {
    await initTreeSitterParser(RustGrammar);
    expect(isParserReady(RustGrammar)).toBe(true);
  });

  test("returns false for unknown grammar", () => {
    expect(
      isParserReady({
        language: "Unknown",
        wasmFile: "tree-sitter-unknown.wasm",
        symbolQuery: "",
      }),
    ).toBe(false);
  });
});

describe("extractSymbols", () => {
  test("extracts top-level symbols from source", async () => {
    const { parser, query } = await initTreeSitterParser(RustGrammar);
    const source = "pub fn greet() {}\nfn internal() {}\n";
    const symbols = extractSymbols(parser, query, source, "lib.rs", RustHooks);
    const names = symbols.map((s) => s.name);
    expect(names).toContain("greet");
    expect(names).toContain("internal");
  });

  test("excludes nested symbols", async () => {
    const { parser, query } = await initTreeSitterParser(RustGrammar);
    const source = `
pub struct Config { port: u16 }
impl Config {
    pub fn new() -> Self { Config { port: 8080 } }
}
`;
    const symbols = extractSymbols(parser, query, source, "lib.rs", RustHooks);
    const names = symbols.map((s) => s.name);
    expect(names).toContain("Config");
    expect(names).toContain("Config"); // impl
    // "new" is nested inside impl — should NOT appear
    expect(names).not.toContain("new");
  });

  test("returns empty for empty source", async () => {
    const { parser, query } = await initTreeSitterParser(RustGrammar);
    expect(extractSymbols(parser, query, "", "lib.rs")).toEqual([]);
  });

  test("uses default hooks when none provided", async () => {
    const { parser, query } = await initTreeSitterParser(RustGrammar);
    const source = "pub fn greet() {}\n";
    // No hooks — should still extract, with exported defaulting to true
    const symbols = extractSymbols(parser, query, source, "lib.rs");
    expect(symbols).toHaveLength(1);
    expect(symbols[0].name).toBe("greet");
    expect(symbols[0].exported).toBe(true); // default
  });

  test("applies custom hooks", async () => {
    const { parser, query } = await initTreeSitterParser(RustGrammar);
    const source = "pub fn greet() {}\nfn internal() {}\n";
    const symbols = extractSymbols(parser, query, source, "lib.rs", RustHooks);
    const exportMap = Object.fromEntries(symbols.map((s) => [s.name, s.exported]));
    expect(exportMap["greet"]).toBe(true);
    expect(exportMap["internal"]).toBe(false);
  });
});

describe("validateTreeSitterSyntax", () => {
  test("returns null for valid source", async () => {
    const { parser } = await initTreeSitterParser(RustGrammar);
    expect(validateTreeSitterSyntax(parser, RustGrammar, "pub fn greet() {}")).toBeNull();
  });

  test("returns error for invalid source", async () => {
    const { parser } = await initTreeSitterParser(RustGrammar);
    const result = validateTreeSitterSyntax(parser, RustGrammar, "pub fn greet( {{{");
    expect(result).toBeString();
    expect(result).toContain("Rust");
  });

  test("returns null for empty source", async () => {
    const { parser } = await initTreeSitterParser(RustGrammar);
    expect(validateTreeSitterSyntax(parser, RustGrammar, "")).toBeNull();
  });
});

describe("makeTreeSitterPlugin", () => {
  test("returns AstPlugin with correct extensions", async () => {
    const plugin = await makeTreeSitterPlugin(new Set([".rs"]), RustGrammar, RustHooks);
    expect(plugin.extensions.has(".rs")).toBe(true);
    expect(plugin.extensions.has(".ts")).toBe(false);
  });

  test("parseSymbols delegates to extractSymbols", async () => {
    const plugin = await makeTreeSitterPlugin(new Set([".rs"]), RustGrammar, RustHooks);
    const symbols = plugin.parseSymbols("pub fn greet() {}\n", "lib.rs");
    expect(symbols).toHaveLength(1);
    expect(symbols[0].name).toBe("greet");
    expect(symbols[0].kind).toBe("function");
  });

  test("locateSymbol returns Some for existing symbol", async () => {
    const plugin = await makeTreeSitterPlugin(new Set([".rs"]), RustGrammar, RustHooks);
    const result = plugin.locateSymbol(
      "pub fn greet() {}\npub fn farewell() {}\n",
      "greet",
      "lib.rs",
    );
    expect(Option.isSome(result)).toBe(true);
    if (Option.isSome(result)) {
      expect(result.value.start).toBeGreaterThanOrEqual(0);
      expect(result.value.end).toBeGreaterThan(result.value.start);
    }
  });

  test("locateSymbol returns None for missing symbol", async () => {
    const plugin = await makeTreeSitterPlugin(new Set([".rs"]), RustGrammar, RustHooks);
    const result = plugin.locateSymbol("pub fn greet() {}\n", "nonexistent", "lib.rs");
    expect(Option.isNone(result)).toBe(true);
  });

  test("validateSyntax returns None for valid code", async () => {
    const plugin = await makeTreeSitterPlugin(new Set([".rs"]), RustGrammar, RustHooks);
    const result = plugin.validateSyntax("pub fn greet() {}", "lib.rs");
    expect(Option.isNone(result)).toBe(true);
  });

  test("validateSyntax returns Some for invalid code", async () => {
    const plugin = await makeTreeSitterPlugin(new Set([".rs"]), RustGrammar, RustHooks);
    const result = plugin.validateSyntax("pub fn greet( {{{", "lib.rs");
    expect(Option.isSome(result)).toBe(true);
  });
});
