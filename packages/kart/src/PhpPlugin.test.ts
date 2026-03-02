import { describe, expect, it } from "bun:test";

import { Option } from "effect";

import { makePhpAstPlugin, PhpLspPluginImpl } from "./PhpPlugin.js";

describe("PhpLspPluginImpl", () => {
  it("handles .php extension", () => {
    expect(PhpLspPluginImpl.extensions.has(".php")).toBe(true);
    expect(PhpLspPluginImpl.extensions.has(".ts")).toBe(false);
  });

  it("returns php languageId", () => {
    expect(PhpLspPluginImpl.languageId("index.php")).toBe("php");
  });
});

describe("makePhpAstPlugin", () => {
  it("handles .php extension after init", async () => {
    const plugin = await makePhpAstPlugin();
    expect(plugin.extensions.has(".php")).toBe(true);
  });

  it("parses PHP symbols", async () => {
    const plugin = await makePhpAstPlugin();
    const source = `<?php
function greet(string $name): string {
    return "Hello $name";
}

class UserController {
    public function index() {}
}

interface Renderable {
    public function render(): string;
}

enum Status {
    case Active;
    case Inactive;
}
`;
    const symbols = plugin.parseSymbols(source, "test.php");
    const names = symbols.map((s) => s.name);
    expect(names).toContain("greet");
    expect(names).toContain("UserController");
    expect(names).toContain("Renderable");
    expect(names).toContain("Status");
  });

  it("extracts correct kinds", async () => {
    const plugin = await makePhpAstPlugin();
    const source = `<?php
function hello() {}
class Foo {}
interface Bar {}
enum Baz {}
`;
    const symbols = plugin.parseSymbols(source, "test.php");
    const kindMap = Object.fromEntries(symbols.map((s) => [s.name, s.kind]));
    expect(kindMap["hello"]).toBe("function");
    expect(kindMap["Foo"]).toBe("class");
    expect(kindMap["Bar"]).toBe("interface");
    expect(kindMap["Baz"]).toBe("enum");
  });

  it("locateSymbol returns range for existing symbol", async () => {
    const plugin = await makePhpAstPlugin();
    const source = `<?php
function greet() {}
function farewell() {}
`;
    const result = plugin.locateSymbol(source, "greet", "test.php");
    expect(Option.isSome(result)).toBe(true);
    if (Option.isSome(result)) {
      expect(result.value.start).toBeGreaterThan(0);
      expect(result.value.end).toBeGreaterThan(result.value.start);
    }
  });

  it("locateSymbol returns none for missing symbol", async () => {
    const plugin = await makePhpAstPlugin();
    const result = plugin.locateSymbol("<?php\nfunction greet() {}", "nonexistent", "test.php");
    expect(Option.isNone(result)).toBe(true);
  });

  it("validateSyntax returns none for valid PHP", async () => {
    const plugin = await makePhpAstPlugin();
    const result = plugin.validateSyntax("<?php\nfunction greet() {}", "test.php");
    expect(Option.isNone(result)).toBe(true);
  });

  it("validateSyntax returns error for invalid PHP", async () => {
    const plugin = await makePhpAstPlugin();
    const result = plugin.validateSyntax("<?php\nfunction greet( {{{", "test.php");
    expect(Option.isSome(result)).toBe(true);
  });
});
