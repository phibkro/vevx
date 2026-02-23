import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { clearSymbolCache, findSymbols } from "./Find.js";

mkdirSync("/tmp/claude", { recursive: true });

// ── Helpers ──

let tempDir: string;

beforeEach(() => {
  tempDir = realpathSync(mkdtempSync(join("/tmp/claude/", "kart-find-")));
  clearSymbolCache();
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

  test("returns cachedFiles=0 and metadata on cold start", async () => {
    writeFixture("a.ts", FIXTURE_A);
    const result = await findSymbols({ name: "", rootDir: tempDir });
    expect(result.cachedFiles).toBe(0);
    expect(result.fileCount).toBe(1);
    expect(typeof result.durationMs).toBe("number");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("returns empty for no matches", async () => {
    writeFixture("a.ts", FIXTURE_A);
    const result = await findSymbols({ name: "nonexistent_xyz", rootDir: tempDir });
    expect(result.symbols).toHaveLength(0);
  });
});

// ── Cache behavior ──

describe("symbol cache", () => {
  test("second call returns cachedFiles > 0", async () => {
    writeFixture("a.ts", FIXTURE_A);
    writeFixture("b.ts", FIXTURE_B);

    const first = await findSymbols({ name: "", rootDir: tempDir });
    expect(first.cachedFiles).toBe(0);
    expect(first.fileCount).toBe(2);

    const second = await findSymbols({ name: "", rootDir: tempDir });
    expect(second.cachedFiles).toBe(2);
    expect(second.fileCount).toBe(2);
    expect(second.symbols.length).toBe(first.symbols.length);
  });

  test("cache invalidates when file mtime changes", async () => {
    writeFixture("a.ts", FIXTURE_A);

    const first = await findSymbols({ name: "", rootDir: tempDir });
    const firstNames = first.symbols.map((s) => s.name);
    expect(firstNames).not.toContain("newFn");

    // Ensure mtime advances (filesystem resolution can be 1s on some OS)
    await new Promise((r) => setTimeout(r, 50));

    // Modify the file — mtime changes
    writeFixture("a.ts", FIXTURE_A + "\nexport function newFn() {}\n");

    const second = await findSymbols({ name: "", rootDir: tempDir });
    const secondNames = second.symbols.map((s) => s.name);
    expect(secondNames).toContain("newFn");
    // One file was re-parsed (mtime changed), so cachedFiles should be 0
    expect(second.cachedFiles).toBe(0);
  });

  test("cache evicts deleted files", async () => {
    writeFixture("a.ts", FIXTURE_A);
    writeFixture("b.ts", FIXTURE_B);

    // Populate cache
    const first = await findSymbols({ name: "", rootDir: tempDir });
    expect(first.fileCount).toBe(2);

    // Delete one file
    rmSync(join(tempDir, "b.ts"));

    const second = await findSymbols({ name: "", rootDir: tempDir });
    expect(second.fileCount).toBe(1);
    expect(second.cachedFiles).toBe(1); // a.ts still cached
    const names = second.symbols.map((s) => s.name);
    expect(names).not.toContain("Config");
    expect(names).not.toContain("Server");
  });

  test("clearSymbolCache resets cache", async () => {
    writeFixture("a.ts", FIXTURE_A);

    await findSymbols({ name: "", rootDir: tempDir });
    clearSymbolCache();

    const result = await findSymbols({ name: "", rootDir: tempDir });
    expect(result.cachedFiles).toBe(0);
  });
});
