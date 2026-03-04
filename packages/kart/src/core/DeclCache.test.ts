import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { buildDeclarations, isCacheStale, readDeclaration } from "./DeclCache.js";

// ── Helpers ──

const TEST_ROOT = "/tmp/claude/kart-declcache-test";

function writeFile(path: string, content: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content, "utf-8");
}

// ── Fixtures ──

const MATH_TS = `
/** Adds two numbers together. */
export function add(a: number, b: number): number {
  return a + b;
}

/** The ratio of a circle's circumference to its diameter. */
export const PI = 3.14159;

export interface Point {
  readonly x: number;
  readonly y: number;
}
`;

const GEO_TS = `
import type { Point } from "./math.js";

export function distance(a: Point, b: Point): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}
`;

// ── Setup / Teardown ──

beforeAll(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
  mkdirSync(TEST_ROOT, { recursive: true });

  // Minimal package.json so tsc can find the project
  writeFile(join(TEST_ROOT, "package.json"), JSON.stringify({ type: "module" }));

  // Source files
  writeFile(join(TEST_ROOT, "src", "math.ts"), MATH_TS);
  writeFile(join(TEST_ROOT, "src", "geo.ts"), GEO_TS);
});

afterAll(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
});

// ── Tests ──

describe.skipIf(!!process.env.TURBO_HASH)("DeclCache", () => {
  test("buildDeclarations generates .d.ts files", async () => {
    const result = await buildDeclarations(TEST_ROOT);

    expect(result.success).toBe(true);
    expect(result.durationMs).toBeGreaterThan(0);
    expect(result.error).toBeUndefined();

    // Verify .d.ts files exist
    const mathDts = join(TEST_ROOT, ".kart", "decls", "src", "math.d.ts");
    const geoDts = join(TEST_ROOT, ".kart", "decls", "src", "geo.d.ts");

    expect(existsSync(mathDts)).toBe(true);
    expect(existsSync(geoDts)).toBe(true);

    // Verify content has expected declarations
    const mathContent = readFileSync(mathDts, "utf-8");
    expect(mathContent).toContain("export declare function add");
    expect(mathContent).toContain("export declare const PI");
    expect(mathContent).toContain("export interface Point");

    const geoContent = readFileSync(geoDts, "utf-8");
    expect(geoContent).toContain("export declare function distance");
  });

  test("buildDeclarations preserves JSDoc", async () => {
    // Build already ran in previous test, but run again to be self-contained
    await buildDeclarations(TEST_ROOT);

    const mathDts = join(TEST_ROOT, ".kart", "decls", "src", "math.d.ts");
    const content = readFileSync(mathDts, "utf-8");

    expect(content).toContain("Adds two numbers together");
    expect(content).toContain("circumference");
  });

  test("readDeclaration returns .d.ts content for a source file", async () => {
    await buildDeclarations(TEST_ROOT);

    const content = readDeclaration(TEST_ROOT, "src/math.ts");

    expect(content).not.toBeNull();
    expect(content!).toContain("export declare function add");
    expect(content!).toContain("export interface Point");
  });

  test("readDeclaration works with absolute source path", async () => {
    await buildDeclarations(TEST_ROOT);

    const absPath = join(TEST_ROOT, "src", "math.ts");
    const content = readDeclaration(TEST_ROOT, absPath);

    expect(content).not.toBeNull();
    expect(content!).toContain("export declare function add");
    expect(content!).toContain("export interface Point");
  });

  test("readDeclaration returns null for nonexistent source file", () => {
    const content = readDeclaration(TEST_ROOT, "src/nonexistent.ts");

    expect(content).toBeNull();
  });

  test("isCacheStale detects when source is newer than cache", async () => {
    await buildDeclarations(TEST_ROOT);

    // Immediately after build, cache should be fresh
    expect(isCacheStale(TEST_ROOT)).toBe(false);

    // Touch a source file to make it newer than .built
    const mathPath = join(TEST_ROOT, "src", "math.ts");
    const future = new Date(Date.now() + 2000);
    utimesSync(mathPath, future, future);

    expect(isCacheStale(TEST_ROOT)).toBe(true);
  });
});
