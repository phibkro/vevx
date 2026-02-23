import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { findSymbols } from "./Find.js";

mkdirSync("/tmp/claude", { recursive: true });

// ── Helpers ──

let tempDir: string;

beforeEach(() => {
  tempDir = realpathSync(mkdtempSync(join("/tmp/claude/", "kart-find-")));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function writeFixture(relPath: string, content: string): void {
  const abs = join(tempDir, relPath);
  const dir = abs.slice(0, abs.lastIndexOf("/"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(abs, content);
}

// ── Fixtures ──

const FIXTURE_A = `
export function greet(name: string): string {
  return \`Hello \${name}\`;
}

export const MAX = 100;

function internal() {}
`;

const FIXTURE_B = `
export interface Config {
  host: string;
  port: number;
}

export class Server {}

const secret = "hidden";
`;

// ── Tests ──

describe("findSymbols", () => {
  test("finds function by exact name", async () => {
    writeFixture("a.ts", FIXTURE_A);
    const result = await findSymbols({ name: "greet", rootDir: tempDir });
    expect(result.symbols).toHaveLength(1);
    expect(result.symbols[0].name).toBe("greet");
    expect(result.symbols[0].kind).toBe("function");
    expect(result.symbols[0].file).toBe("a.ts");
  });

  test("substring match finds multiple symbols", async () => {
    writeFixture("a.ts", FIXTURE_A);
    writeFixture("b.ts", FIXTURE_B);
    // "e" appears in "greet", "Server", "secret"
    const result = await findSymbols({ name: "e", rootDir: tempDir });
    const names = result.symbols.map((s) => s.name);
    expect(names).toContain("greet");
    expect(names).toContain("Server");
    expect(names).toContain("secret");
  });

  test("empty name matches all symbols", async () => {
    writeFixture("a.ts", FIXTURE_A);
    const result = await findSymbols({ name: "", rootDir: tempDir });
    expect(result.symbols.length).toBeGreaterThanOrEqual(3); // greet, MAX, internal
  });

  test("filters by kind", async () => {
    writeFixture("a.ts", FIXTURE_A);
    writeFixture("b.ts", FIXTURE_B);
    const result = await findSymbols({ name: "", kind: "interface", rootDir: tempDir });
    expect(result.symbols).toHaveLength(1);
    expect(result.symbols[0].name).toBe("Config");
    expect(result.symbols[0].kind).toBe("interface");
  });

  test("filters by exported", async () => {
    writeFixture("a.ts", FIXTURE_A);
    const result = await findSymbols({ name: "", exported: false, rootDir: tempDir });
    const names = result.symbols.map((s) => s.name);
    expect(names).toContain("internal");
    expect(names).not.toContain("greet");
    expect(names).not.toContain("MAX");
  });

  test("scopes to path subdirectory", async () => {
    writeFixture("src/a.ts", FIXTURE_A);
    writeFixture("lib/b.ts", FIXTURE_B);
    const result = await findSymbols({ name: "", path: "src", rootDir: tempDir });
    const files = result.symbols.map((s) => s.file);
    for (const f of files) {
      expect(f).toMatch(/^src\//);
    }
    expect(result.symbols.length).toBeGreaterThan(0);
  });

  test("excludes node_modules", async () => {
    writeFixture("src/a.ts", FIXTURE_A);
    writeFixture("node_modules/pkg/index.ts", 'export const foo = "bar";\n');
    const result = await findSymbols({ name: "foo", rootDir: tempDir });
    expect(result.symbols).toHaveLength(0);
  });

  test("returns truncated=false and metadata for normal case", async () => {
    writeFixture("a.ts", FIXTURE_A);
    const result = await findSymbols({ name: "", rootDir: tempDir });
    expect(result.truncated).toBe(false);
    expect(result.fileCount).toBe(1);
    expect(typeof result.durationMs).toBe("number");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("returns empty for no matches", async () => {
    writeFixture("a.ts", FIXTURE_A);
    const result = await findSymbols({ name: "nonexistent_xyz", rootDir: tempDir });
    expect(result.symbols).toHaveLength(0);
    expect(result.truncated).toBe(false);
  });
});
