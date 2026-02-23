import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { isExported } from "./ExportDetection.js";
import type { DocumentSymbol } from "./types.js";

// ── Fixtures ──

const FIXTURE_DIR = resolve(import.meta.dir, "../__fixtures__");
const FIXTURE_PATH = join(FIXTURE_DIR, "exports.ts");
const FIXTURE_CONTENT = readFileSync(FIXTURE_PATH, "utf-8");

// ── Pure function tests (no LSP needed) ──

describe("isExported (text scanning)", () => {
  // Build a minimal DocumentSymbol at a given line
  const symbolAt = (name: string, line: number): DocumentSymbol => ({
    name,
    kind: 12, // Function
    range: { start: { line, character: 0 }, end: { line, character: 0 } },
    selectionRange: { start: { line, character: 0 }, end: { line, character: 0 } },
  });

  // Map symbol names to their expected export status from the fixture
  const expectedExports: Record<string, boolean> = {
    greet: true,
    MAX_COUNT: true,
    UserService: true,
    Config: true,
    ID: true,
    defaultFn: true,
    helper: false,
    INTERNAL: false,
    InternalService: false,
    InternalConfig: false,
    InternalId: false,
  };

  // Build a line index from the fixture content
  const lines = FIXTURE_CONTENT.split("\n");
  const lineIndex = new Map<string, number>();
  for (const [name] of Object.entries(expectedExports)) {
    const idx = lines.findIndex(
      (l) =>
        l.includes(`function ${name}`) ||
        l.includes(`const ${name}`) ||
        l.includes(`class ${name}`) ||
        l.includes(`interface ${name}`) ||
        l.includes(`type ${name}`),
    );
    if (idx !== -1) lineIndex.set(name, idx);
  }

  for (const [name, expected] of Object.entries(expectedExports)) {
    const line = lineIndex.get(name);
    if (line === undefined) continue;

    test(`${name} → ${expected ? "exported" : "not exported"}`, () => {
      const sym = symbolAt(name, line);
      expect(isExported(sym, lines)).toBe(expected);
    });
  }

  test("returns false for out-of-range line", () => {
    const sym = symbolAt("ghost", 9999);
    expect(isExported(sym, lines)).toBe(false);
  });
});

describe("isExported — Rust pub detection", () => {
  const symbolAt = (name: string, line: number): DocumentSymbol => ({
    name,
    kind: 12,
    range: { start: { line, character: 0 }, end: { line, character: 0 } },
    selectionRange: { start: { line, character: 0 }, end: { line, character: 0 } },
  });

  const rustLines = [
    "pub fn greet(name: &str) -> String {",
    "fn internal() {}",
    "pub struct Config {",
    "pub(crate) fn restricted() {}",
  ];

  test("pub fn is exported", () => {
    expect(isExported(symbolAt("greet", 0), rustLines)).toBe(true);
  });

  test("fn without pub is not exported", () => {
    expect(isExported(symbolAt("internal", 1), rustLines)).toBe(false);
  });

  test("pub struct is exported", () => {
    expect(isExported(symbolAt("Config", 2), rustLines)).toBe(true);
  });

  test("pub(crate) is exported", () => {
    expect(isExported(symbolAt("restricted", 3), rustLines)).toBe(true);
  });
});
