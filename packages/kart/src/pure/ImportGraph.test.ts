import { describe, expect, test } from "bun:test";

import { buildImportGraph, extractFileImports, transitiveImporters } from "./ImportGraph.js";
import type { ResolveFn } from "./Resolve.js";

// ── Mock resolver ──

/** Simple mock resolver: maps specifier → absolute path via a lookup table. */
function mockResolver(table: Record<string, string>): ResolveFn {
  return (specifier: string, _fromDir: string) => table[specifier] ?? null;
}

// ── extractFileImports ──

describe("extractFileImports", () => {
  test("extracts named imports", () => {
    const source = 'import { Effect, Layer } from "effect";\n';
    const result = extractFileImports(source, "test.ts");
    expect(result.imports).toHaveLength(1);
    expect(result.imports[0].specifier).toBe("effect");
    expect(result.imports[0].importedNames).toEqual(["Effect", "Layer"]);
    expect(result.imports[0].isTypeOnly).toBe(false);
    expect(result.imports[0].isReExport).toBe(false);
  });

  test("extracts type-only imports", () => {
    const source = 'import type { Config } from "./types.js";\n';
    const result = extractFileImports(source, "test.ts");
    expect(result.imports).toHaveLength(1);
    expect(result.imports[0].isTypeOnly).toBe(true);
  });

  test("extracts namespace imports", () => {
    const source = 'import * as path from "node:path";\n';
    const result = extractFileImports(source, "test.ts");
    expect(result.imports).toHaveLength(1);
    expect(result.imports[0].specifier).toBe("node:path");
    expect(result.imports[0].importedNames).toEqual([]);
  });

  test("extracts default imports", () => {
    const source = 'import React from "react";\n';
    const result = extractFileImports(source, "test.ts");
    expect(result.imports).toHaveLength(1);
    expect(result.imports[0].importedNames).toEqual(["default"]);
  });

  test("extracts re-exports", () => {
    const source = 'export { foo, bar } from "./foo.js";\nexport * from "./bar.js";\n';
    const result = extractFileImports(source, "test.ts");
    expect(result.imports).toHaveLength(2);
    expect(result.imports[0].isReExport).toBe(true);
    expect(result.imports[0].importedNames).toEqual(["foo", "bar"]);
    expect(result.imports[1].isReExport).toBe(true);
    expect(result.imports[1].importedNames).toEqual([]); // star re-export
  });

  test("extracts type re-exports", () => {
    const source = 'export type { Baz } from "./baz.js";\n';
    const result = extractFileImports(source, "test.ts");
    expect(result.imports).toHaveLength(1);
    expect(result.imports[0].isTypeOnly).toBe(true);
    expect(result.imports[0].isReExport).toBe(true);
  });

  test("detects barrel file (only re-exports)", () => {
    const source = 'export { foo } from "./foo.js";\nexport * from "./bar.js";\n';
    const result = extractFileImports(source, "index.ts");
    expect(result.isBarrel).toBe(true);
    expect(result.exportedNames).toEqual(["foo"]); // star re-export names unknown
  });

  test("non-barrel file has local declarations", () => {
    const source = 'import { x } from "./x.js";\nexport function greet() {}\n';
    const result = extractFileImports(source, "test.ts");
    expect(result.isBarrel).toBe(false);
    expect(result.exportedNames).toContain("greet");
  });

  test("exported names include all export forms", () => {
    const source = `
export function greet() {}
export const MAX = 100;
export class Server {}
export interface Config {}
export type ID = string;
const internal = 1;
`;
    const result = extractFileImports(source, "test.ts");
    expect(result.exportedNames).toEqual(["greet", "MAX", "Server", "Config", "ID"]);
  });

  test("export { foo } local re-export counts as local export", () => {
    const source = `const foo = 1;\nconst bar = 2;\nexport { foo, bar };\n`;
    const result = extractFileImports(source, "test.ts");
    expect(result.isBarrel).toBe(false);
    expect(result.exportedNames).toContain("foo");
    expect(result.exportedNames).toContain("bar");
  });

  test("export default counts as local export", () => {
    const source = `export default function main() {}\n`;
    const result = extractFileImports(source, "test.ts");
    expect(result.isBarrel).toBe(false);
    expect(result.exportedNames).toContain("main");
  });

  test("export default anonymous uses 'default' name", () => {
    const source = `export default 42;\n`;
    const result = extractFileImports(source, "test.ts");
    expect(result.exportedNames).toContain("default");
  });
});

// ── buildImportGraph ──

describe("buildImportGraph", () => {
  test("builds graph from source map", () => {
    const sources = new Map([
      ["/project/a.ts", 'import { greet } from "./b.js";\nconst x = 1;\n'],
      ["/project/b.ts", "export function greet() {}\n"],
    ]);
    const resolve = mockResolver({ "./b.js": "/project/b.ts" });
    const graph = buildImportGraph(sources, resolve);

    expect(graph.fileCount).toBe(2);
    expect(graph.importCount).toBe(1);

    const aImports = graph.files.get("/project/a.ts");
    expect(aImports).toBeDefined();
    expect(aImports!.imports).toHaveLength(1);
    expect(aImports!.imports[0].resolvedPath).toBe("/project/b.ts");
    expect(aImports!.imports[0].importedNames).toEqual(["greet"]);
  });

  test("unresolvable specifiers get null resolvedPath", () => {
    const sources = new Map([["/project/a.ts", 'import { Effect } from "effect";\n']]);
    const resolve = mockResolver({});
    const graph = buildImportGraph(sources, resolve);

    const aImports = graph.files.get("/project/a.ts");
    expect(aImports!.imports[0].resolvedPath).toBeNull();
  });

  test("empty source map produces empty graph", () => {
    const graph = buildImportGraph(new Map(), mockResolver({}));
    expect(graph.fileCount).toBe(0);
    expect(graph.importCount).toBe(0);
  });
});

// ── transitiveImporters ──

describe("transitiveImporters", () => {
  test("finds direct importers", () => {
    const sources = new Map([
      ["/p/a.ts", 'import { x } from "./b.js";\n'],
      ["/p/b.ts", "export const x = 1;\n"],
      ["/p/c.ts", 'import { x } from "./b.js";\n'],
    ]);
    const resolve = mockResolver({ "./b.js": "/p/b.ts" });
    const graph = buildImportGraph(sources, resolve);
    const result = transitiveImporters("/p/b.ts", graph);

    expect(result.directImporters.sort()).toEqual(["/p/a.ts", "/p/c.ts"]);
    expect(result.barrelImporters).toEqual([]);
    expect(result.totalImporters).toBe(2);
  });

  test("expands through barrel files", () => {
    const sources = new Map([
      ["/p/lib/session.ts", "export function createSession() {}\n"],
      ["/p/lib/index.ts", 'export { createSession } from "./session.js";\n'],
      ["/p/app.ts", 'import { createSession } from "./lib/index.js";\n'],
      ["/p/cli.ts", 'import { createSession } from "./lib/session.js";\n'],
    ]);
    const resolve = mockResolver({
      "./session.js": "/p/lib/session.ts",
      "./lib/index.js": "/p/lib/index.ts",
      "./lib/session.js": "/p/lib/session.ts",
    });
    const graph = buildImportGraph(sources, resolve);
    const result = transitiveImporters("/p/lib/session.ts", graph);

    expect(result.directImporters.sort()).toEqual(["/p/cli.ts", "/p/lib/index.ts"]);
    expect(result.barrelImporters).toEqual(["/p/app.ts"]);
    expect(result.totalImporters).toBe(3);
  });

  test("handles file not in graph", () => {
    const graph = buildImportGraph(new Map(), mockResolver({}));
    const result = transitiveImporters("/p/missing.ts", graph);
    expect(result.directImporters).toEqual([]);
    expect(result.totalImporters).toBe(0);
  });

  test("prevents cycles in barrel expansion", () => {
    const sources = new Map([
      ["/p/a.ts", "export const x = 1;\n"],
      ["/p/index.ts", 'export { x } from "./a.js";\n'],
      ["/p/barrel2.ts", 'export * from "./index.js";\n'],
      ["/p/consumer.ts", 'import { x } from "./barrel2.js";\n'],
    ]);
    const resolve = mockResolver({
      "./a.js": "/p/a.ts",
      "./index.js": "/p/index.ts",
      "./barrel2.js": "/p/barrel2.ts",
    });
    const graph = buildImportGraph(sources, resolve);
    const result = transitiveImporters("/p/a.ts", graph);

    // index.ts is direct, consumer.ts reaches a.ts through two barrels
    // barrel2.ts is an intermediary barrel, not a separate consumer
    expect(result.totalImporters).toBe(2);
  });
});
