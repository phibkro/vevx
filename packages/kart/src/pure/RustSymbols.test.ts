import { beforeAll, describe, expect, test } from "bun:test";

import { initRustParser, isRustParserReady, parseRustSymbols } from "./RustSymbols.js";

const FIXTURE = `\
use std::collections::HashMap;

pub fn greet(name: &str) -> String {
    format!("Hello {}", name)
}

fn internal() {}

pub struct Config {
    pub host: String,
    pub port: u16,
}

pub enum Status {
    Active,
    Inactive,
}

trait Greetable {
    fn greet(&self) -> String;
}

impl Config {
    pub fn new() -> Self {
        Self { host: String::new(), port: 0 }
    }
}

impl Greetable for Config {
    fn greet(&self) -> String {
        format!("Config at {}:{}", self.host, self.port)
    }
}

pub type Alias = HashMap<String, String>;

pub const MAX: u32 = 100;

pub static GLOBAL: &str = "hello";

mod inner {
    pub fn nested() {}
}

macro_rules! my_macro {
    () => {};
}`;

beforeAll(async () => {
  await initRustParser();
});

describe("parseRustSymbols", () => {
  test("extracts all top-level declarations", () => {
    const symbols = parseRustSymbols(FIXTURE, "lib.rs");
    const names = symbols.map((s) => s.name);

    expect(names).toEqual([
      "greet",
      "internal",
      "Config",
      "Status",
      "Greetable",
      "Config",
      "Greetable for Config",
      "Alias",
      "MAX",
      "GLOBAL",
      "inner",
      "my_macro",
    ]);
  });

  test("detects pub vs private correctly", () => {
    const symbols = parseRustSymbols(FIXTURE, "lib.rs");
    // Use kind:name as key to avoid collisions (e.g. struct Config vs impl Config)
    const exportMap = Object.fromEntries(symbols.map((s) => [`${s.kind}:${s.name}`, s.exported]));

    expect(exportMap["function:greet"]).toBe(true);
    expect(exportMap["function:internal"]).toBe(false);
    expect(exportMap["struct:Config"]).toBe(true);
    expect(exportMap["enum:Status"]).toBe(true);
    expect(exportMap["trait:Greetable"]).toBe(false);
    expect(exportMap["impl:Config"]).toBe(false); // impl block without pub
    expect(exportMap["impl:Greetable for Config"]).toBe(false);
    expect(exportMap["type:Alias"]).toBe(true);
    expect(exportMap["const:MAX"]).toBe(true);
    expect(exportMap["static:GLOBAL"]).toBe(true);
    expect(exportMap["mod:inner"]).toBe(false);
    expect(exportMap["macro:my_macro"]).toBe(false);
  });

  test("assigns correct kinds", () => {
    const symbols = parseRustSymbols(FIXTURE, "lib.rs");
    const kindMap = Object.fromEntries(symbols.map((s) => [`${s.kind}:${s.name}`, s.kind]));

    expect(kindMap["function:greet"]).toBe("function");
    expect(kindMap["function:internal"]).toBe("function");
    expect(kindMap["struct:Config"]).toBe("struct");
    expect(kindMap["enum:Status"]).toBe("enum");
    expect(kindMap["trait:Greetable"]).toBe("trait");
    expect(kindMap["impl:Config"]).toBe("impl");
    expect(kindMap["impl:Greetable for Config"]).toBe("impl");
    expect(kindMap["type:Alias"]).toBe("type");
    expect(kindMap["const:MAX"]).toBe("const");
    expect(kindMap["static:GLOBAL"]).toBe("static");
    expect(kindMap["mod:inner"]).toBe("mod");
    expect(kindMap["macro:my_macro"]).toBe("macro");
  });

  test("names impl blocks correctly", () => {
    const symbols = parseRustSymbols(FIXTURE, "lib.rs");
    const impls = symbols.filter((s) => s.kind === "impl");

    expect(impls).toHaveLength(2);
    expect(impls[0].name).toBe("Config");
    expect(impls[1].name).toBe("Greetable for Config");
  });

  test("includes line numbers and byte ranges", () => {
    const symbols = parseRustSymbols(FIXTURE, "lib.rs");
    const greet = symbols.find((s) => s.name === "greet" && s.kind === "function")!;

    expect(greet.line).toBeGreaterThan(0);
    expect(greet.range.start).toBeLessThan(greet.range.end);

    // Verify the range actually covers the source text
    const sliced = FIXTURE.slice(greet.range.start, greet.range.end);
    expect(sliced).toContain("pub fn greet");
  });

  test("empty source returns []", () => {
    expect(parseRustSymbols("", "empty.rs")).toEqual([]);
  });
});

describe("initRustParser", () => {
  test("is idempotent", async () => {
    expect(isRustParserReady()).toBe(true);
    await initRustParser(); // second call — should not throw
    expect(isRustParserReady()).toBe(true);
  });
});
