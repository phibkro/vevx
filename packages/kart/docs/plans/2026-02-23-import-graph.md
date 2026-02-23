# Import Graph Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `kart_imports` and `kart_importers` tools that build a workspace-wide import graph using oxc-parser, with tsconfig-aware path resolution and transparent barrel file expansion.

**Architecture:** Two pure modules (`pure/Resolve.ts` for tsconfig path resolution, `pure/ImportGraph.ts` for oxc-based graph construction) compose into a stateless service layer (`Imports.ts`) that exposes two MCP tools. The graph is built on-demand per request — no persistent state. `buildImportGraph` takes a pre-loaded source map + injectable resolver, keeping the pure boundary clean.

**Tech Stack:** oxc-parser (AST-based import extraction), Bun.resolveSync (production path resolution), bun:test (testing)

---

### Task 1: Pure tsconfig resolution module

Copy the tsconfig resolution functions from `packages/varp/src/manifest/imports.ts` into kart. Drop `extractImports` (oxc replaces it) and `analyzeImports`/`scanImports` (varp-specific). Keep only the resolution primitives.

**Files:**
- Create: `src/pure/Resolve.ts`
- Create: `src/pure/Resolve.test.ts`

**Step 1: Write the test file**

```typescript
// src/pure/Resolve.test.ts
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { loadTsconfigPaths, resolveAlias, type PathAliases } from "./Resolve.js";

mkdirSync("/tmp/claude", { recursive: true });

describe("loadTsconfigPaths", () => {
  test("returns null when tsconfig.json missing", () => {
    const result = loadTsconfigPaths("/tmp/claude/nonexistent-dir-xyz");
    expect(result).toBeNull();
  });

  test("returns null when tsconfig has no paths", () => {
    const dir = mkdtempSync(join("/tmp/claude/", "resolve-"));
    try {
      writeFileSync(
        join(dir, "tsconfig.json"),
        JSON.stringify({ compilerOptions: { target: "ES2022" } }),
      );
      const result = loadTsconfigPaths(dir);
      expect(result).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("loads wildcard path mappings", () => {
    const dir = mkdtempSync(join("/tmp/claude/", "resolve-"));
    try {
      writeFileSync(
        join(dir, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: { paths: { "#shared/*": ["./src/shared/*"] } },
        }),
      );
      const result = loadTsconfigPaths(dir);
      expect(result).not.toBeNull();
      expect(result!.mappings).toHaveLength(1);
      expect(result!.mappings[0].pattern).toBe("#shared/*");
      expect(result!.baseDir).toBe(resolve(dir));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("follows extends chain", () => {
    const dir = mkdtempSync(join("/tmp/claude/", "resolve-"));
    try {
      writeFileSync(
        join(dir, "tsconfig.base.json"),
        JSON.stringify({
          compilerOptions: { paths: { "@app/*": ["./app/*"] } },
        }),
      );
      writeFileSync(
        join(dir, "tsconfig.json"),
        JSON.stringify({ extends: "./tsconfig.base.json" }),
      );
      const result = loadTsconfigPaths(dir);
      expect(result).not.toBeNull();
      expect(result!.mappings).toHaveLength(1);
      expect(result!.mappings[0].pattern).toBe("@app/*");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("resolveAlias", () => {
  const aliases: PathAliases = {
    mappings: [
      { pattern: "#shared/*", targets: ["./src/shared/*"] },
      { pattern: "#config", targets: ["./src/config.ts"] },
    ],
    baseDir: "/project",
  };

  test("resolves wildcard alias", () => {
    const result = resolveAlias("#shared/types.js", aliases);
    expect(result).toBe("/project/src/shared/types.js");
  });

  test("resolves exact alias", () => {
    const result = resolveAlias("#config", aliases);
    expect(result).toBe("/project/src/config.ts");
  });

  test("returns null for non-matching specifier", () => {
    const result = resolveAlias("./local.js", aliases);
    expect(result).toBeNull();
  });

  test("returns null for bare package specifier", () => {
    const result = resolveAlias("effect", aliases);
    expect(result).toBeNull();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test src/pure/Resolve.test.ts`
Expected: FAIL — module `./Resolve.js` not found

**Step 3: Write the implementation**

Copy from `packages/varp/src/manifest/imports.ts` lines 38-261. Keep:
- `stripJsonComments`
- `readTsconfig`
- `resolveExtendsPath`
- `resolveTsconfigOptions`
- `loadTsconfigPaths`
- `aliasPrefixesFrom`
- `resolveAlias`
- `resolveSpecifier`
- `bunResolve`
- Types: `PathMapping`, `PathAliases`, `ResolveFn`

Drop: `extractImports`, `analyzeImports`, `scanImports`, `SourceFile`, `ImportDep`, all varp manifest types.

```typescript
// src/pure/Resolve.ts
/**
 * TypeScript path resolution utilities.
 *
 * Handles tsconfig.json path aliases (including extends chains)
 * and specifier-to-absolute-path resolution.
 *
 * Copied from @vevx/varp manifest/imports.ts — kart is standalone,
 * no varp dependency. Only the resolution primitives, no import extraction.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, parse as parsePath, resolve } from "node:path";

// ── Types ──

export type ResolveFn = (specifier: string, fromDir: string) => string | null;

export type PathMapping = {
  readonly pattern: string;
  readonly targets: readonly string[];
};

export type PathAliases = {
  readonly mappings: readonly PathMapping[];
  readonly baseDir: string;
};

// ── tsconfig parsing ──

function stripJsonComments(text: string): string {
  return text.replace(/"(?:[^"\\]|\\.)*"|\/\/.*$|\/\*[\s\S]*?\*\//gm, (match) =>
    match.startsWith('"') ? match : "",
  );
}

interface TsconfigCompilerOptions {
  paths?: Record<string, string[]>;
  baseUrl?: string;
}

interface TsconfigRaw {
  extends?: string;
  compilerOptions?: TsconfigCompilerOptions;
}

function readTsconfig(filePath: string): TsconfigRaw | null {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
  try {
    return JSON.parse(stripJsonComments(raw));
  } catch {
    return null;
  }
}

function resolveExtendsPath(specifier: string, fromDir: string): string | null {
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    const resolved = resolve(fromDir, specifier);
    if (!resolved.endsWith(".json")) {
      if (existsSync(resolved + ".json")) return resolved + ".json";
      if (existsSync(resolved)) return resolved;
      return resolved + ".json";
    }
    return resolved;
  }

  const nmBase = join(fromDir, "node_modules", specifier);
  if (existsSync(nmBase) && !nmBase.endsWith(".json")) {
    const inner = join(nmBase, "tsconfig.json");
    if (existsSync(inner)) return inner;
  }
  if (existsSync(nmBase)) return nmBase;
  if (!nmBase.endsWith(".json") && existsSync(nmBase + ".json")) return nmBase + ".json";

  return null;
}

function resolveTsconfigOptions(
  filePath: string,
  visited: Set<string>,
): TsconfigCompilerOptions | null {
  const abs = resolve(filePath);
  if (visited.has(abs)) return null;
  visited.add(abs);

  const parsed = readTsconfig(abs);
  if (!parsed) return null;

  let parentOptions: TsconfigCompilerOptions = {};
  if (parsed.extends) {
    const parentPath = resolveExtendsPath(parsed.extends, dirname(abs));
    if (parentPath) {
      parentOptions = resolveTsconfigOptions(parentPath, visited) ?? {};
    }
  }

  const mergedPaths = { ...parentOptions.paths, ...parsed.compilerOptions?.paths };
  return {
    baseUrl: parsed.compilerOptions?.baseUrl ?? parentOptions.baseUrl,
    paths: Object.keys(mergedPaths).length > 0 ? mergedPaths : undefined,
  };
}

// ── Public API ──

export function loadTsconfigPaths(dir: string): PathAliases | null {
  const tsconfigPath = join(dir, "tsconfig.json");
  const options = resolveTsconfigOptions(tsconfigPath, new Set());
  if (!options) return null;

  const paths = options.paths;
  if (!paths || Object.keys(paths).length === 0) return null;

  const baseUrl = options.baseUrl ?? ".";
  const baseDir = resolve(dir, baseUrl);

  const mappings: PathMapping[] = Object.entries(paths).map(([pattern, targets]) => ({
    pattern,
    targets,
  }));

  return { mappings, baseDir };
}

export function aliasPrefixesFrom(aliases: PathAliases): string[] {
  return aliases.mappings.map((m) =>
    m.pattern.endsWith("/*") ? m.pattern.slice(0, -1) : m.pattern,
  );
}

export function resolveAlias(specifier: string, aliases: PathAliases): string | null {
  for (const mapping of aliases.mappings) {
    if (mapping.pattern.endsWith("/*")) {
      const prefix = mapping.pattern.slice(0, -1);
      if (specifier.startsWith(prefix)) {
        const rest = specifier.slice(prefix.length);
        const target = mapping.targets[0];
        if (!target) continue;
        const targetBase = target.endsWith("/*") ? target.slice(0, -1) : target;
        return resolve(aliases.baseDir, targetBase + rest);
      }
    } else {
      if (specifier === mapping.pattern) {
        const target = mapping.targets[0];
        if (!target) continue;
        return resolve(aliases.baseDir, target);
      }
    }
  }
  return null;
}

export function resolveSpecifier(
  specifier: string,
  fromDir: string,
  resolveFn: ResolveFn,
  aliases?: PathAliases,
): string | null {
  if (aliases && !specifier.startsWith("./") && !specifier.startsWith("../")) {
    const aliased = resolveAlias(specifier, aliases);
    if (aliased) return resolveFn(aliased, fromDir) ?? aliased;
  }
  return resolveFn(specifier, fromDir);
}

export function bunResolve(specifier: string, fromDir: string): string | null {
  try {
    return Bun.resolveSync(specifier, fromDir);
  } catch {
    return null;
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test src/pure/Resolve.test.ts`
Expected: All 8 tests PASS

**Step 5: Commit**

```bash
git add src/pure/Resolve.ts src/pure/Resolve.test.ts
git commit -m "feat(kart): add pure tsconfig resolution module

Copy resolution primitives from @vevx/varp for standalone use.
Handles path aliases, extends chains, and specifier resolution.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 2: Pure import graph module

Build the core import graph using oxc-parser for AST-based import extraction. Fully pure — takes `Map<string, string>` (path → source) and injectable `ResolveFn`, returns the graph structure.

**Files:**
- Modify: `src/pure/types.ts` (add import graph types)
- Create: `src/pure/ImportGraph.ts`
- Create: `src/pure/ImportGraph.test.ts`

**Step 1: Add types to `src/pure/types.ts`**

Append to end of file:

```typescript
// ── Import graph types ──

export type ImportEntry = {
  /** The raw import specifier as written in source. */
  readonly specifier: string;
  /** Resolved absolute path (null if unresolvable — external package). */
  readonly resolvedPath: string | null;
  /** Imported symbol names. Empty for namespace/default imports. */
  readonly importedNames: readonly string[];
  /** True for `import type` or `export type`. */
  readonly isTypeOnly: boolean;
  /** True for `export { ... } from` or `export * from`. */
  readonly isReExport: boolean;
};

export type FileImports = {
  readonly path: string;
  readonly imports: readonly ImportEntry[];
  /** Exported symbol names from this file (for unused export detection). */
  readonly exportedNames: readonly string[];
  /** True if this file only contains re-exports (no local declarations). */
  readonly isBarrel: boolean;
};

export type ImportGraph = {
  /** Map from absolute file path to its imports. */
  readonly files: ReadonlyMap<string, FileImports>;
  /** Total files in the graph. */
  readonly fileCount: number;
  /** Total import statements processed. */
  readonly importCount: number;
  /** Milliseconds to build. */
  readonly durationMs: number;
};

export type ImportsResult = {
  readonly path: string;
  readonly imports: readonly {
    readonly specifier: string;
    readonly resolvedPath: string | null;
    readonly importedNames: readonly string[];
    readonly isTypeOnly: boolean;
  }[];
  readonly totalImports: number;
};

export type ImportersResult = {
  readonly path: string;
  /** Files that directly import this file. */
  readonly directImporters: readonly string[];
  /** Files that import this file through barrel re-exports. */
  readonly barrelImporters: readonly string[];
  /** All unique importers (direct + barrel). */
  readonly totalImporters: number;
};
```

**Step 2: Write the test file**

```typescript
// src/pure/ImportGraph.test.ts
import { describe, expect, test } from "bun:test";

import { extractFileImports, buildImportGraph, transitiveImporters } from "./ImportGraph.js";
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
    const sources = new Map([
      ["/project/a.ts", 'import { Effect } from "effect";\n'],
    ]);
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
    // Barrel re-exports from another barrel
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

    expect(result.totalImporters).toBe(3); // index.ts, barrel2.ts, consumer.ts
  });
});
```

**Step 3: Run tests to verify they fail**

Run: `bun test src/pure/ImportGraph.test.ts`
Expected: FAIL — module `./ImportGraph.js` not found

**Step 4: Write the implementation**

```typescript
// src/pure/ImportGraph.ts
/**
 * Import graph construction using oxc-parser AST.
 *
 * Pure module — takes pre-loaded source map + injectable resolver.
 * No filesystem or LSP dependency.
 */

import { parseSync } from "oxc-parser";
import { dirname } from "node:path";

import type { ResolveFn } from "./Resolve.js";
import type {
  FileImports,
  ImportEntry,
  ImportGraph,
  ImportersResult,
} from "./types.js";

// ── AST node types ──

const IMPORT_DECLARATION = "ImportDeclaration";
const EXPORT_NAMED = "ExportNamedDeclaration";
const EXPORT_ALL = "ExportAllDeclaration";
const EXPORT_DEFAULT = "ExportDefaultDeclaration";

// Declaration types that produce local exports (not re-exports)
const DECLARATION_KINDS = new Set([
  "FunctionDeclaration",
  "ClassDeclaration",
  "TSInterfaceDeclaration",
  "TSTypeAliasDeclaration",
  "TSEnumDeclaration",
  "VariableDeclaration",
]);

// ── Import extraction ──

/** Extract all import/export-from statements and exported names from source using oxc AST. */
export function extractFileImports(source: string, filename: string): Omit<FileImports, "path"> {
  const lang = filename.endsWith(".tsx") ? "tsx" : "ts";
  const result = parseSync(filename, source, { lang, sourceType: "module" });
  const body: any[] = (result as any).program.body;

  const imports: ImportEntry[] = [];
  const exportedNames: string[] = [];
  let hasLocalExport = false;

  for (const node of body) {
    if (node.type === IMPORT_DECLARATION) {
      imports.push(importFromDeclaration(node));
    } else if (node.type === EXPORT_ALL && node.source) {
      // export * from "./foo.js"
      imports.push({
        specifier: node.source.value,
        resolvedPath: null, // resolved later
        importedNames: [],
        isTypeOnly: node.exportKind === "type",
        isReExport: true,
      });
    } else if (node.type === EXPORT_NAMED) {
      if (node.source) {
        // export { foo } from "./foo.js" — re-export
        const names = node.specifiers.map((s: any) => s.local.name);
        imports.push({
          specifier: node.source.value,
          resolvedPath: null,
          importedNames: names,
          isTypeOnly: node.exportKind === "type",
          isReExport: true,
        });
        exportedNames.push(...names);
      } else if (node.declaration) {
        // export function foo() {} — local export
        hasLocalExport = true;
        const name = extractDeclName(node.declaration);
        if (name) exportedNames.push(name);
      } else if (node.specifiers?.length > 0 && !node.source) {
        // export { foo } — re-export of local binding, counts as local
        hasLocalExport = true;
        for (const s of node.specifiers) {
          exportedNames.push(s.exported?.name ?? s.local.name);
        }
      }
    } else if (node.type === EXPORT_DEFAULT) {
      hasLocalExport = true;
      const name = node.declaration?.id?.name ?? "default";
      exportedNames.push(name);
    }
  }

  const isBarrel = imports.some((i) => i.isReExport) && !hasLocalExport;

  return { imports, exportedNames, isBarrel };
}

function importFromDeclaration(node: any): ImportEntry {
  const specifiers: any[] = node.specifiers ?? [];
  const names: string[] = [];

  for (const s of specifiers) {
    if (s.type === "ImportSpecifier") {
      names.push(s.imported.name);
    } else if (s.type === "ImportDefaultSpecifier") {
      names.push("default");
    }
    // ImportNamespaceSpecifier: no individual names
  }

  return {
    specifier: node.source.value,
    resolvedPath: null, // resolved later
    importedNames: names,
    isTypeOnly: node.importKind === "type",
    isReExport: false,
  };
}

function extractDeclName(decl: any): string | null {
  if (!DECLARATION_KINDS.has(decl.type)) return null;
  if (decl.type === "VariableDeclaration") {
    return decl.declarations?.[0]?.id?.name ?? null;
  }
  return decl.id?.name ?? null;
}

// ── Graph construction ──

/**
 * Build an import graph from pre-loaded sources.
 *
 * @param sources - Map from absolute file path to source content
 * @param resolveFn - Resolves (specifier, fromDir) → absolute path or null
 */
export function buildImportGraph(
  sources: ReadonlyMap<string, string>,
  resolveFn: ResolveFn,
): ImportGraph {
  const start = performance.now();
  const files = new Map<string, FileImports>();
  let importCount = 0;

  for (const [filePath, source] of sources) {
    const extracted = extractFileImports(source, filePath);
    const fromDir = dirname(filePath);

    // Resolve all import specifiers
    const resolved: ImportEntry[] = extracted.imports.map((imp) => ({
      ...imp,
      resolvedPath: resolveFn(imp.specifier, fromDir),
    }));

    importCount += resolved.length;

    files.set(filePath, {
      path: filePath,
      imports: resolved,
      exportedNames: extracted.exportedNames,
      isBarrel: extracted.isBarrel,
    });
  }

  return {
    files,
    fileCount: sources.size,
    importCount,
    durationMs: Math.round(performance.now() - start),
  };
}

// ── Graph queries ──

/** Build a reverse index: target path → files that import it. */
function buildReverseIndex(graph: ImportGraph): Map<string, string[]> {
  const reverse = new Map<string, string[]>();

  for (const [filePath, fileImports] of graph.files) {
    for (const imp of fileImports.imports) {
      if (!imp.resolvedPath) continue;
      const existing = reverse.get(imp.resolvedPath);
      if (existing) {
        existing.push(filePath);
      } else {
        reverse.set(imp.resolvedPath, [filePath]);
      }
    }
  }

  return reverse;
}

/**
 * Find all files that import the given file, expanding through barrel files.
 *
 * Direct importers: files whose import statements resolve to `targetPath`.
 * Barrel importers: files that import a barrel which re-exports from `targetPath`.
 */
export function transitiveImporters(
  targetPath: string,
  graph: ImportGraph,
): Omit<ImportersResult, "path"> {
  const reverse = buildReverseIndex(graph);
  const directImporters = reverse.get(targetPath) ?? [];

  // Expand through barrels: find barrel files that import targetPath,
  // then find importers of those barrels (recursively).
  const barrelImporters: string[] = [];
  const visited = new Set<string>([targetPath]);

  const barrelQueue = directImporters.filter((p) => graph.files.get(p)?.isBarrel);
  for (const barrel of barrelQueue) {
    if (visited.has(barrel)) continue;
    visited.add(barrel);

    const barrelConsumers = reverse.get(barrel) ?? [];
    for (const consumer of barrelConsumers) {
      if (visited.has(consumer)) continue;

      if (graph.files.get(consumer)?.isBarrel) {
        // Nested barrel — continue expanding
        barrelQueue.push(consumer);
      } else {
        barrelImporters.push(consumer);
        visited.add(consumer);
      }
    }
  }

  const allImporters = new Set([...directImporters, ...barrelImporters]);

  return {
    directImporters: directImporters.sort(),
    barrelImporters: barrelImporters.sort(),
    totalImporters: allImporters.size,
  };
}
```

**Step 5: Run tests to verify they pass**

Run: `bun test src/pure/ImportGraph.test.ts`
Expected: All 13 tests PASS

**Step 6: Commit**

```bash
git add src/pure/types.ts src/pure/ImportGraph.ts src/pure/ImportGraph.test.ts
git commit -m "feat(kart): add pure import graph module

oxc-parser based import extraction with injectable resolver.
Barrel detection and transitive importer expansion via BFS.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 3: Impure service layer and MCP tools

Wire the pure modules into stateless async handlers and register two new MCP tools: `kart_imports` and `kart_importers`.

**Files:**
- Create: `src/Imports.ts`
- Create: `src/Imports.test.ts`
- Modify: `src/Tools.ts` (add 2 tool definitions)
- Modify: `src/Mcp.ts` (register 2 tools)

**Step 1: Write the integration test**

```typescript
// src/Imports.test.ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { getImports, getImporters } from "./Imports.js";

mkdirSync("/tmp/claude", { recursive: true });

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join("/tmp/claude/", "kart-imports-"));
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

  test("filters out external packages", async () => {
    writeFixture("a.ts", 'import { Effect } from "effect";\nimport { x } from "./b.js";\n');
    writeFixture("b.ts", "export const x = 1;\n");

    const result = await getImports(join(tempDir, "a.ts"), tempDir);
    // Both imports present, but external has null resolvedPath
    const external = result.imports.find((i) => i.specifier === "effect");
    expect(external?.resolvedPath).toBeNull();
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
    expect(result.directImporters.map((p) => p.replace(tempDir + "/", "")).sort()).toEqual([
      "a.ts",
      "c.ts",
    ]);
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
```

**Step 2: Run tests to verify they fail**

Run: `bun test src/Imports.test.ts`
Expected: FAIL — module `./Imports.js` not found

**Step 3: Write the service layer**

```typescript
// src/Imports.ts
/**
 * Import graph queries — impure shell.
 *
 * Reads files from disk, injects bunResolve, delegates to pure ImportGraph.
 * Stateless async functions — no Effect or LSP dependency.
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { buildImportGraph, extractFileImports, transitiveImporters } from "./pure/ImportGraph.js";
import { bunResolve, loadTsconfigPaths, resolveSpecifier, type PathAliases } from "./pure/Resolve.js";
import type { ImportersResult, ImportsResult } from "./pure/types.js";

// ── Constants ──

const FILE_CAP = 2000;
const EXCLUDED_DIRS = new Set(["node_modules", ".git", "dist", "build", ".varp"]);
const TS_EXTENSIONS = new Set([".ts", ".tsx"]);

// ── File collection ──

function collectTsFiles(dir: string): string[] {
  const results: string[] = [];

  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      results.push(...collectTsFiles(join(dir, entry.name)));
    } else if (entry.isFile()) {
      const ext = entry.name.lastIndexOf(".");
      if (ext !== -1 && TS_EXTENSIONS.has(entry.name.slice(ext))) {
        results.push(join(dir, entry.name));
      }
    }
  }

  return results;
}

function loadSources(rootDir: string): Map<string, string> {
  const files = collectTsFiles(rootDir);
  const capped = files.length > FILE_CAP ? files.slice(0, FILE_CAP) : files;
  const sources = new Map<string, string>();

  for (const filePath of capped) {
    try {
      sources.set(filePath, readFileSync(filePath, "utf-8"));
    } catch {
      /* skip unreadable files */
    }
  }

  return sources;
}

function makeResolver(rootDir: string): (specifier: string, fromDir: string) => string | null {
  const aliases = loadTsconfigPaths(rootDir);
  return (specifier: string, fromDir: string) =>
    resolveSpecifier(specifier, fromDir, bunResolve, aliases ?? undefined);
}

function isWithinWorkspace(filePath: string, rootDir: string): boolean {
  const resolved = resolve(filePath);
  const root = resolve(rootDir);
  return resolved.startsWith(root + "/") || resolved === root;
}

// ── Public API ──

export type ImportsArgs = {
  path: string;
  rootDir?: string;
};

export type ImportersArgs = {
  path: string;
  rootDir?: string;
};

/** Get imports for a single file. */
export async function getImports(filePath: string, rootDir?: string): Promise<ImportsResult> {
  const root = rootDir ?? process.cwd();
  const absPath = resolve(filePath);

  if (!isWithinWorkspace(absPath, root)) {
    return { path: absPath, imports: [], totalImports: 0 };
  }

  let source: string;
  try {
    source = readFileSync(absPath, "utf-8");
  } catch {
    return { path: absPath, imports: [], totalImports: 0 };
  }

  const aliases = loadTsconfigPaths(root);
  const resolveFn = (specifier: string, fromDir: string) =>
    resolveSpecifier(specifier, fromDir, bunResolve, aliases ?? undefined);

  const extracted = extractFileImports(source, absPath);
  const fromDir = dirname(absPath);

  const imports = extracted.imports.map((imp) => ({
    specifier: imp.specifier,
    resolvedPath: resolveFn(imp.specifier, fromDir),
    importedNames: imp.importedNames,
    isTypeOnly: imp.isTypeOnly,
  }));

  return { path: absPath, imports, totalImports: imports.length };
}

/** Get all files that import the given file (with barrel expansion). */
export async function getImporters(filePath: string, rootDir?: string): Promise<ImportersResult> {
  const root = rootDir ?? process.cwd();
  const absPath = resolve(filePath);

  if (!isWithinWorkspace(absPath, root)) {
    return { path: absPath, directImporters: [], barrelImporters: [], totalImporters: 0 };
  }

  const sources = loadSources(root);
  const resolveFn = makeResolver(root);
  const graph = buildImportGraph(sources, resolveFn);
  const result = transitiveImporters(absPath, graph);

  return { path: absPath, ...result };
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test src/Imports.test.ts`
Expected: All 7 tests PASS

**Step 5: Add tool definitions to `src/Tools.ts`**

Add imports at top of file:
```typescript
import { getImports, getImporters } from "./Imports.js";
```

Add tool definitions before the `tools` array:

```typescript
export const kart_imports = {
  name: "kart_imports",
  description:
    "Returns what a file imports: specifiers, resolved paths, imported symbol names, and type-only status. Uses oxc-parser (no LSP needed). Useful for understanding a file's dependencies.",
  annotations: READ_ONLY,
  inputSchema: {
    path: z.string().describe("Absolute or workspace-relative file path to analyze"),
  },
  handler: (args: { path: string }) => Effect.promise(() => getImports(args.path)),
} as const;

export const kart_importers = {
  name: "kart_importers",
  description:
    "Returns files that import the given file, with transparent barrel expansion. Direct importers are files with explicit imports. Barrel importers come through index.ts re-export files. Uses oxc-parser (no LSP needed).",
  annotations: READ_ONLY,
  inputSchema: {
    path: z.string().describe("Absolute or workspace-relative file path to find importers for"),
  },
  handler: (args: { path: string }) => Effect.promise(() => getImporters(args.path)),
} as const;
```

Add `kart_imports` and `kart_importers` to the `tools` array.

**Step 6: Register tools in `src/Mcp.ts`**

Add imports:
```typescript
import { getImports, getImporters, type ImportsArgs, type ImportersArgs } from "./Imports.js";
```

Add to imports from Tools.ts:
```typescript
import { ..., kart_imports, kart_importers } from "./Tools.js";
```

Add registration blocks (same stateless pattern as kart_find):

```typescript
// Register kart_imports (stateless — no Effect runtime needed)
server.registerTool(
  kart_imports.name,
  {
    description: kart_imports.description,
    inputSchema: kart_imports.inputSchema,
    annotations: kart_imports.annotations,
  },
  async (args) => {
    try {
      const result = await getImports((args as ImportsArgs).path, rootDir);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    } catch (e) {
      return {
        content: [{ type: "text" as const, text: `Error: ${errorMessage(e)}` }],
        isError: true,
      };
    }
  },
);

// Register kart_importers (stateless — no Effect runtime needed)
server.registerTool(
  kart_importers.name,
  {
    description: kart_importers.description,
    inputSchema: kart_importers.inputSchema,
    annotations: kart_importers.annotations,
  },
  async (args) => {
    try {
      const result = await getImporters((args as ImportersArgs).path, rootDir);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    } catch (e) {
      return {
        content: [{ type: "text" as const, text: `Error: ${errorMessage(e)}` }],
        isError: true,
      };
    }
  },
);
```

**Step 7: Run all integration tests**

Run: `bun test src/Imports.test.ts`
Expected: All 7 tests PASS

**Step 8: Commit**

```bash
git add src/Imports.ts src/Imports.test.ts src/Tools.ts src/Mcp.ts
git commit -m "feat(kart): add kart_imports and kart_importers tools

Stateless import graph queries using oxc-parser + Bun.resolveSync.
Transparent barrel file expansion for kart_importers.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 4: MCP integration tests and doc updates

Add MCP-level integration tests for the new tools, update tool listing test, and update docs.

**Files:**
- Modify: `src/Mcp.test.ts` (add tool listing + integration tests)
- Modify: `docs/design.md` (add import graph section)
- Modify: `docs/architecture.md` (update module listing + test counts)

**Step 1: Update Mcp.test.ts tool listing**

In the `"lists all kart tools"` test, add `"kart_importers"` and `"kart_imports"` to the sorted expected array.

**Step 2: Add MCP integration tests**

Add a new describe block after the existing kart_find tests in `Mcp.test.ts`:

```typescript
// ── kart_imports / kart_importers tests (no LSP needed) ──

describe("MCP integration — kart_imports", () => {
  let client: Client;
  let tempDir: string;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    tempDir = await mkdtemp(join("/tmp/claude/", "kart-mcp-imports-"));

    await writeFile(
      join(tempDir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "bundler" },
      }),
    );
    await writeFile(join(tempDir, "a.ts"), 'import { greet } from "./b.js";\nconst x = 1;\n');
    await writeFile(join(tempDir, "b.ts"), "export function greet() {}\n");

    const server = createServer({ dbPath: join(tempDir, "no.db"), rootDir: tempDir });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "test-imports", version: "0.1.0" });

    await Promise.all([server.connect(st), client.connect(ct)]);

    cleanup = async () => {
      await Promise.all([server.close(), client.close()]);
      await rm(tempDir, { recursive: true, force: true });
    };
  });

  afterAll(async () => {
    await cleanup();
  });

  test("kart_imports returns imports for a file", async () => {
    const result = await client.callTool({
      name: "kart_imports",
      arguments: { path: join(tempDir, "a.ts") },
    });
    const data = parseResult(result) as { imports: { specifier: string }[]; totalImports: number };
    expect(data.totalImports).toBeGreaterThanOrEqual(1);
    expect(data.imports.some((i) => i.specifier === "./b.js")).toBe(true);
  });

  test("kart_importers returns importers of a file", async () => {
    const result = await client.callTool({
      name: "kart_importers",
      arguments: { path: join(tempDir, "b.ts") },
    });
    const data = parseResult(result) as {
      directImporters: string[];
      totalImporters: number;
    };
    expect(data.totalImporters).toBeGreaterThanOrEqual(1);
    expect(data.directImporters.some((p) => p.endsWith("a.ts"))).toBe(true);
  });
});
```

**Step 3: Run all tests**

Run: `bun test src/Mcp.test.ts`
Expected: All tests PASS (including updated tool count)

Run: `bun test --concurrent src/pure/`
Expected: All pure tests PASS

Run: `bun test --concurrent src/*.test.ts`
Expected: All integration tests PASS

**Step 4: Update docs/design.md**

Add to shipped tools table:
```
| `kart_imports` | file import list with resolved paths | oxc-parser + Bun.resolveSync |
| `kart_importers` | reverse import lookup with barrel expansion | oxc-parser + Bun.resolveSync |
```

Add section 3.10:
```markdown
### 3.10 import graph

`kart_imports(path)` returns what a file imports: raw specifiers, resolved absolute paths, imported symbol names, and type-only status. Uses oxc AST for extraction and `Bun.resolveSync` for tsconfig-aware resolution.

`kart_importers(path)` returns all files that import the given file. Barrel files (index.ts that only re-export) are expanded transparently — if `auth/index.ts` re-exports from `auth/session.ts`, then `kart_importers("auth/session.ts")` includes files that import via the barrel.

Both tools are stateless (no LSP, no Effect runtime). The workspace import graph is built on-demand per request — oxc parsing + Bun resolution is fast enough that caching isn't needed at typical codebase sizes.
```

**Step 5: Update docs/architecture.md**

Update tool count (13→15), add `Imports.ts` to module listing, update test counts.

**Step 6: Commit**

```bash
git add src/Mcp.test.ts docs/design.md docs/architecture.md
git commit -m "feat(kart): MCP integration tests and docs for import graph

15 tools total. Import graph uses oxc + Bun.resolveSync.
Transparent barrel expansion in kart_importers.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 5: Run full test suite and verify

**Step 1: Run pure tests with coverage**

Run: `bun run test:pure`
Expected: All pure tests PASS with coverage

**Step 2: Run integration tests**

Run: `bun run test:integration`
Expected: All integration tests PASS

**Step 3: Run lint and format**

Run: `bun run check`
Expected: Format OK, lint OK, build OK

**Step 4: Verify tool count**

Run: `bun test src/Mcp.test.ts --test-name-pattern "lists all kart tools"`
Expected: PASS with 15 tools listed
