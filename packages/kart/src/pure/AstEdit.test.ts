import { beforeAll, describe, expect, test } from "bun:test";

import {
  locateSymbol,
  spliceInsertAfter,
  spliceInsertBefore,
  spliceReplace,
  validateSyntax,
} from "./AstEdit.js";
import { initRustParser } from "./RustSymbols.js";

describe("locateSymbol", () => {
  test("finds function by name", () => {
    const source = "function greet(name: string): string { return name; }";
    const range = locateSymbol(source, "greet", "test.ts");

    expect(range).not.toBeNull();
    expect(range!.start).toBe(0);
    expect(range!.end).toBe(source.length);
  });

  test("finds exported function (range includes export keyword)", () => {
    const source = "export function greet(name: string): string { return name; }";
    const range = locateSymbol(source, "greet", "test.ts");

    expect(range).not.toBeNull();
    const sliced = source.slice(range!.start, range!.end);
    expect(sliced).toStartWith("export");
  });

  test("finds class", () => {
    const source = "class UserService { run() {} }";
    const range = locateSymbol(source, "UserService", "test.ts");

    expect(range).not.toBeNull();
    expect(source.slice(range!.start, range!.end)).toBe(source);
  });

  test("finds type alias", () => {
    const source = "type ID = string | number;";
    const range = locateSymbol(source, "ID", "test.ts");

    expect(range).not.toBeNull();
    expect(source.slice(range!.start, range!.end)).toBe(source);
  });

  test("finds const", () => {
    const source = "const MAX = 100;";
    const range = locateSymbol(source, "MAX", "test.ts");

    expect(range).not.toBeNull();
    expect(source.slice(range!.start, range!.end)).toBe(source);
  });

  test("returns null for missing symbol", () => {
    const source = "function greet() {}";
    const range = locateSymbol(source, "missing", "test.ts");

    expect(range).toBeNull();
  });

  test("range covers full declaration", () => {
    const source = "export const CONFIG = { port: 3000, host: 'localhost' };";
    const range = locateSymbol(source, "CONFIG", "test.ts");

    expect(range).not.toBeNull();
    const sliced = source.slice(range!.start, range!.end);
    expect(sliced).toContain("export const CONFIG");
    expect(sliced).toContain("localhost");
  });
});

describe("validateSyntax", () => {
  test("returns null for valid code", () => {
    const result = validateSyntax("const x = 42;", "test.ts");
    expect(result).toBeNull();
  });

  test("returns error message for invalid code", () => {
    const result = validateSyntax("const x = ;", "test.ts");
    expect(result).toBeString();
    expect(result!.length).toBeGreaterThan(0);
  });

  test("validates tsx", () => {
    const result = validateSyntax("export function App() { return <div>hello</div>; }", "app.tsx");
    expect(result).toBeNull();
  });
});

describe("spliceReplace", () => {
  test("replaces content at range", () => {
    const file = "aaa bbb ccc";
    const result = spliceReplace(file, { start: 4, end: 7 }, "BBB");
    expect(result).toBe("aaa BBB ccc");
  });

  test("handles different-length replacement", () => {
    const file = "aaa bbb ccc";
    const result = spliceReplace(file, { start: 4, end: 7 }, "LONGER");
    expect(result).toBe("aaa LONGER ccc");
  });
});

describe("spliceInsertAfter", () => {
  test("inserts after range end", () => {
    const file = "aaa bbb ccc";
    const result = spliceInsertAfter(file, { start: 4, end: 7 }, " INSERTED");
    expect(result).toBe("aaa bbb INSERTED ccc");
  });
});

describe("spliceInsertBefore", () => {
  test("inserts before range start", () => {
    const file = "aaa bbb ccc";
    const result = spliceInsertBefore(file, { start: 4, end: 7 }, "INSERTED ");
    expect(result).toBe("aaa INSERTED bbb ccc");
  });
});

describe("Rust support", () => {
  beforeAll(async () => {
    await initRustParser();
  });

  const RUST_SOURCE = `pub fn greet(name: &str) -> String {
    format!("Hello {}", name)
}

pub const MAX: i32 = 100;

struct Point {
    x: f64,
    y: f64,
}

impl Point {
    fn new(x: f64, y: f64) -> Self {
        Point { x, y }
    }
}
`;

  describe("locateSymbol (Rust)", () => {
    test("finds fn by name", () => {
      const range = locateSymbol(RUST_SOURCE, "greet", "lib.rs");
      expect(range).not.toBeNull();
      const sliced = RUST_SOURCE.slice(range!.start, range!.end);
      expect(sliced).toContain("pub fn greet");
      expect(sliced).toContain("Hello {}");
    });

    test("finds const by name", () => {
      const range = locateSymbol(RUST_SOURCE, "MAX", "lib.rs");
      expect(range).not.toBeNull();
      const sliced = RUST_SOURCE.slice(range!.start, range!.end);
      expect(sliced).toContain("pub const MAX");
    });

    test("finds struct by name", () => {
      const range = locateSymbol(RUST_SOURCE, "Point", "lib.rs");
      expect(range).not.toBeNull();
      const sliced = RUST_SOURCE.slice(range!.start, range!.end);
      expect(sliced).toContain("struct Point");
    });

    test("finds impl by name", () => {
      const range = locateSymbol(RUST_SOURCE, "Point", "lib.rs");
      expect(range).not.toBeNull();
    });

    test("returns null for missing symbol", () => {
      const range = locateSymbol(RUST_SOURCE, "nonexistent", "lib.rs");
      expect(range).toBeNull();
    });
  });

  describe("validateSyntax (Rust)", () => {
    test("returns null for valid Rust", () => {
      const result = validateSyntax("fn main() { let x = 42; }", "lib.rs");
      expect(result).toBeNull();
    });

    test("returns error string for invalid Rust", () => {
      const result = validateSyntax("fn foo( {", "lib.rs");
      expect(result).toBeString();
      expect(result).toContain("syntax error");
    });
  });
});
