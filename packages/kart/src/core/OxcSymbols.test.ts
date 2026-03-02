import { describe, expect, test } from "bun:test";

import { parseSymbols } from "./OxcSymbols.js";

describe("parseSymbols", () => {
  test("extracts function declaration", () => {
    const source = "function greet(name: string): string { return name; }";
    const symbols = parseSymbols(source, "test.ts");

    expect(symbols).toHaveLength(1);
    expect(symbols[0]).toEqual({
      name: "greet",
      kind: "function",
      exported: false,
      line: 1,
      range: { start: 0, end: source.length },
    });
  });

  test("extracts class declaration", () => {
    const source = "class UserService { run() {} }";
    const symbols = parseSymbols(source, "test.ts");

    expect(symbols).toHaveLength(1);
    expect(symbols[0].name).toBe("UserService");
    expect(symbols[0].kind).toBe("class");
    expect(symbols[0].exported).toBe(false);
  });

  test("extracts interface declaration", () => {
    const source = "interface Config { port: number; }";
    const symbols = parseSymbols(source, "test.ts");

    expect(symbols).toHaveLength(1);
    expect(symbols[0].name).toBe("Config");
    expect(symbols[0].kind).toBe("interface");
  });

  test("extracts type alias", () => {
    const source = "type ID = string | number;";
    const symbols = parseSymbols(source, "test.ts");

    expect(symbols).toHaveLength(1);
    expect(symbols[0].name).toBe("ID");
    expect(symbols[0].kind).toBe("type");
  });

  test("extracts enum declaration", () => {
    const source = "enum Status { Active, Inactive }";
    const symbols = parseSymbols(source, "test.ts");

    expect(symbols).toHaveLength(1);
    expect(symbols[0].name).toBe("Status");
    expect(symbols[0].kind).toBe("enum");
  });

  test("extracts const, let, and var declarations", () => {
    const source = ["const MAX = 100;", "let count = 0;", 'var legacy = "old";'].join("\n");
    const symbols = parseSymbols(source, "test.ts");

    expect(symbols).toHaveLength(3);
    expect(symbols[0]).toMatchObject({ name: "MAX", kind: "const" });
    expect(symbols[1]).toMatchObject({ name: "count", kind: "let" });
    expect(symbols[2]).toMatchObject({ name: "legacy", kind: "var" });
  });

  test("extracts arrow function assigned to const", () => {
    const source = "const greet = (name: string): string => name;";
    const symbols = parseSymbols(source, "test.ts");

    expect(symbols).toHaveLength(1);
    expect(symbols[0]).toMatchObject({ name: "greet", kind: "const" });
  });

  test("extracts default export function", () => {
    const source = "export default function main() { return 1; }";
    const symbols = parseSymbols(source, "test.ts");

    expect(symbols).toHaveLength(1);
    expect(symbols[0]).toMatchObject({
      name: "main",
      kind: "function",
      exported: true,
    });
  });

  test("extracts exported named declarations", () => {
    const source = "export function greet() {}\nexport const MAX = 1;";
    const symbols = parseSymbols(source, "test.ts");

    expect(symbols).toHaveLength(2);
    expect(symbols[0].exported).toBe(true);
    expect(symbols[1].exported).toBe(true);
  });

  test("multiple declarations preserve ordering", () => {
    const source = [
      "const A = 1;",
      "function b() {}",
      "class C {}",
      "type D = string;",
      "interface E {}",
    ].join("\n");
    const symbols = parseSymbols(source, "test.ts");

    expect(symbols.map((s) => s.name)).toEqual(["A", "b", "C", "D", "E"]);
  });

  test("empty file returns []", () => {
    expect(parseSymbols("", "test.ts")).toEqual([]);
  });

  test("file with only comments returns []", () => {
    const source = "// just a comment\n/* block comment */";
    expect(parseSymbols(source, "test.ts")).toEqual([]);
  });

  test("TSX file works", () => {
    const source = "export function App() { return <div>hello</div>; }";
    const symbols = parseSymbols(source, "component.tsx");

    expect(symbols).toHaveLength(1);
    expect(symbols[0]).toMatchObject({
      name: "App",
      kind: "function",
      exported: true,
    });
  });

  test("range covers full declaration including export keyword", () => {
    const source = "export function greet(name: string): string { return name; }";
    const symbols = parseSymbols(source, "test.ts");

    expect(symbols).toHaveLength(1);
    const sliced = source.slice(symbols[0].range.start, symbols[0].range.end);
    expect(sliced).toBe(source);
    expect(sliced).toStartWith("export");
  });
});
