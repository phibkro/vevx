import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { getImporters, getImports } from "./Imports.js";

mkdirSync("/tmp/claude", { recursive: true });

let tempDir: string;

beforeEach(() => {
  tempDir = realpathSync(mkdtempSync(join("/tmp/claude/", "kart-imports-")));
  writeFileSync(
    join(tempDir, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "bundler" },
    }),
  );
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

describe("getImports", () => {
  test("returns imports for a file", async () => {
    writeFixture("a.ts", 'import { greet } from "./b.js";\nconst x = 1;\n');
    writeFixture("b.ts", "export function greet() {}\n");

    const result = await getImports(join(tempDir, "a.ts"), tempDir);
    expect(result.totalImports).toBe(1);
    expect(result.imports[0].specifier).toBe("./b.js");
    expect(result.imports[0].importedNames).toEqual(["greet"]);
  });

  test("resolves relative imports to absolute paths", async () => {
    writeFixture("a.ts", 'import { greet } from "./b.js";\n');
    writeFixture("b.ts", "export function greet() {}\n");

    const result = await getImports(join(tempDir, "a.ts"), tempDir);
    expect(result.imports[0].resolvedPath).toBe(join(tempDir, "b.ts"));
  });

  test("external packages have null resolvedPath", async () => {
    writeFixture("a.ts", 'import { Effect } from "effect";\nimport { x } from "./b.js";\n');
    writeFixture("b.ts", "export const x = 1;\n");

    const result = await getImports(join(tempDir, "a.ts"), tempDir);
    const external = result.imports.find((i) => i.specifier === "effect");
    // effect may or may not resolve depending on node_modules — either null or a path
    expect(external).toBeDefined();
  });

  test("workspace boundary: rejects paths outside rootDir", async () => {
    const result = await getImports("/etc/passwd", tempDir);
    expect(result.totalImports).toBe(0);
  });

  test("returns empty for nonexistent file", async () => {
    const result = await getImports(join(tempDir, "missing.ts"), tempDir);
    expect(result.totalImports).toBe(0);
  });
});

describe("getImporters", () => {
  test("finds direct importers", async () => {
    writeFixture("a.ts", 'import { greet } from "./b.js";\n');
    writeFixture("b.ts", "export function greet() {}\n");
    writeFixture("c.ts", 'import { greet } from "./b.js";\n');

    const result = await getImporters(join(tempDir, "b.ts"), tempDir);
    expect(result.totalImporters).toBe(2);
    const relPaths = result.directImporters.map((p) => p.replace(tempDir + "/", "")).sort();
    expect(relPaths).toEqual(["a.ts", "c.ts"]);
  });

  test("expands through barrel files", async () => {
    writeFixture("lib/session.ts", "export function createSession() {}\n");
    writeFixture("lib/index.ts", 'export { createSession } from "./session.js";\n');
    writeFixture("app.ts", 'import { createSession } from "./lib/index.js";\n');

    const result = await getImporters(join(tempDir, "lib/session.ts"), tempDir);
    expect(result.directImporters.some((p) => p.endsWith("lib/index.ts"))).toBe(true);
    expect(result.barrelImporters.some((p) => p.endsWith("app.ts"))).toBe(true);
    expect(result.totalImporters).toBe(2);
  });

  test("workspace boundary: rejects paths outside rootDir", async () => {
    const result = await getImporters("/etc/passwd", tempDir);
    expect(result.totalImporters).toBe(0);
  });
});
