# Kart Zoom Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace kart_zoom's overloaded level-based API with depth-based BFS type-graph traversal backed by tsc-generated `.d.ts` declarations.

**Architecture:** Add a `DeclCache` service that runs `tsc --declaration --emitDeclarationOnly --incremental` into `.kart/decls/`. Zoom handler reads cached `.d.ts` files, applies visibility/kind filters, and traverses type references for depth > 0. Rust stays on-demand via tree-sitter with the same filter params.

**Tech Stack:** TypeScript compiler API (subprocess `tsc`), Effect TS services, oxc-parser (directory zoom fast path), tree-sitter (Rust)

---

### Task 1: Add new zoom types and update ZoomResult

**Files:**
- Modify: `packages/kart/src/core/types.ts:200-222`

**Step 1: Write the new types**

Replace `ZoomResult` and add new types. The key changes: `level` → `depth`, drop `truncated`, add `referencedFiles` for BFS results.

```typescript
// ── Zoom types ──

export type ZoomSymbol = {
  readonly name: string;
  readonly kind: string;
  readonly signature: string;
  readonly doc: string | null;
  readonly exported: boolean;
  readonly children?: ZoomSymbol[];
};

export type ZoomFileResult = {
  readonly path: string;
  readonly content: string;
};

export type ZoomResult = {
  readonly path: string;
  readonly depth: number;
  readonly symbols: ZoomSymbol[];
  /** Additional files pulled in by BFS type-graph traversal (depth > 0). */
  readonly referencedFiles?: ZoomFileResult[];
  /** Directory zoom: per-file results. */
  readonly files?: ZoomResult[];
};
```

Note: `resolvedType` dropped from `ZoomSymbol` — tsc declarations include inferred types. `level` → `depth`. `truncated` dropped.

**Step 2: Verify compilation**

Run: `cd packages/kart && bun run build`
Expected: Build errors in Symbols.ts, Mcp.ts, tests — that's expected, we'll fix them in subsequent tasks.

**Step 3: Commit**

```bash
git add packages/kart/src/core/types.ts
git commit -m "refactor(kart): replace zoom level types with depth-based types"
```

---

### Task 2: DeclCache service — tsc declaration generation

**Files:**
- Create: `packages/kart/src/core/DeclCache.ts`
- Create: `packages/kart/src/core/DeclCache.test.ts`

This is the core new module. Pure logic for managing `.kart/decls/` cache via `tsc`.

**Step 1: Write the failing test**

```typescript
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";

mkdirSync("/tmp/claude", { recursive: true });

import { buildDeclarations, isCacheStale, readDeclaration } from "./DeclCache.js";

describe("DeclCache", () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(join("/tmp/claude/", "kart-decl-"));

    // Write a simple TS project
    writeFileSync(
      join(tempDir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "bundler",
          strict: true,
          declaration: true,
          emitDeclarationOnly: true,
          declarationDir: ".kart/decls",
          incremental: true,
          tsBuildInfoFile: ".kart/decls/tsconfig.tsbuildinfo",
        },
        include: ["*.ts"],
      }),
    );

    writeFileSync(
      join(tempDir, "math.ts"),
      [
        "/** Add two numbers. */",
        "export function add(a: number, b: number): number { return a + b; }",
        "export const PI = 3.14;",
        "export interface Point { x: number; y: number; }",
        "function internal() {}",
      ].join("\n"),
    );

    writeFileSync(
      join(tempDir, "geo.ts"),
      [
        'import type { Point } from "./math.js";',
        "export function distance(a: Point, b: Point): number {",
        "  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);",
        "}",
        "export type Line = { start: Point; end: Point };",
      ].join("\n"),
    );
  });

  afterAll(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  });

  test("buildDeclarations generates .d.ts files", async () => {
    const result = await buildDeclarations(tempDir);
    expect(result.success).toBe(true);

    // .d.ts files should exist in .kart/decls/
    const mathDecl = readFileSync(join(tempDir, ".kart/decls/math.d.ts"), "utf-8");
    expect(mathDecl).toContain("export declare function add");
    expect(mathDecl).toContain("export declare const PI");
    expect(mathDecl).toContain("export interface Point");
    // Internal function should not appear
    expect(mathDecl).not.toContain("internal");
  });

  test("buildDeclarations preserves JSDoc", async () => {
    await buildDeclarations(tempDir);
    const mathDecl = readFileSync(join(tempDir, ".kart/decls/math.d.ts"), "utf-8");
    expect(mathDecl).toContain("/** Add two numbers. */");
  });

  test("readDeclaration returns .d.ts content for a source file", async () => {
    await buildDeclarations(tempDir);
    const content = readDeclaration(tempDir, join(tempDir, "math.ts"));
    expect(content).toContain("export declare function add");
  });

  test("readDeclaration returns null for nonexistent source file", async () => {
    await buildDeclarations(tempDir);
    const content = readDeclaration(tempDir, join(tempDir, "nonexistent.ts"));
    expect(content).toBeNull();
  });

  test("isCacheStale detects when source is newer than cache", async () => {
    await buildDeclarations(tempDir);
    expect(isCacheStale(tempDir)).toBe(false);

    // Touch a source file to make cache stale
    const now = new Date(Date.now() + 1000);
    const { utimesSync } = await import("node:fs");
    utimesSync(join(tempDir, "math.ts"), now, now);
    expect(isCacheStale(tempDir)).toBe(true);
  });

  test("incremental rebuild is faster than cold build", async () => {
    // Cold build
    const cold = await buildDeclarations(tempDir);
    expect(cold.success).toBe(true);

    // Touch one file
    const now = new Date(Date.now() + 1000);
    const { utimesSync } = await import("node:fs");
    utimesSync(join(tempDir, "math.ts"), now, now);

    // Incremental rebuild
    const warm = await buildDeclarations(tempDir);
    expect(warm.success).toBe(true);
    // Can't assert timing reliably in CI, just verify it works
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/kart && bun test src/core/DeclCache.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```typescript
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

export type BuildResult = {
  readonly success: boolean;
  readonly durationMs: number;
  readonly error?: string;
};

const DECL_DIR = ".kart/decls";
const TSBUILDINFO = "tsconfig.tsbuildinfo";

/**
 * Run tsc --declaration to generate .d.ts files in .kart/decls/.
 * Uses incremental compilation via .tsbuildinfo when available.
 */
export async function buildDeclarations(rootDir: string): Promise<BuildResult> {
  const declDir = join(rootDir, DECL_DIR);
  mkdirSync(declDir, { recursive: true });

  // Write a tsconfig for declaration generation
  const declTsconfig = {
    compilerOptions: {
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "bundler",
      strict: true,
      declaration: true,
      emitDeclarationOnly: true,
      declarationDir: resolve(declDir),
      incremental: true,
      tsBuildInfoFile: resolve(join(declDir, TSBUILDINFO)),
      skipLibCheck: true,
    },
    include: ["**/*.ts"],
    exclude: ["node_modules", ".kart", "**/*.test.ts", "**/*.integration.test.ts"],
  };

  const configPath = join(declDir, "tsconfig.decl.json");
  writeFileSync(configPath, JSON.stringify(declTsconfig, null, 2));

  const start = performance.now();
  const proc = Bun.spawn(["tsc", "--project", configPath], {
    cwd: rootDir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const exitCode = await proc.exited;
  const durationMs = performance.now() - start;

  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    return { success: false, durationMs, error: stderr };
  }

  // Write build timestamp
  writeFileSync(join(declDir, ".built"), new Date().toISOString());

  return { success: true, durationMs };
}

/**
 * Check if the declaration cache is stale.
 * Compares .built timestamp against newest source file mtime.
 */
export function isCacheStale(rootDir: string): boolean {
  const builtFile = join(rootDir, DECL_DIR, ".built");
  if (!existsSync(builtFile)) return true;

  const builtTime = statSync(builtFile).mtimeMs;
  const newestSource = findNewestMtime(rootDir, rootDir);
  return newestSource > builtTime;
}

function findNewestMtime(dir: string, rootDir: string): number {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".kart" || entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      newest = Math.max(newest, findNewestMtime(full, rootDir));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts") && !entry.name.endsWith(".test.ts")) {
      newest = Math.max(newest, statSync(full).mtimeMs);
    }
  }
  return newest;
}

/**
 * Read the cached .d.ts content for a source file.
 * Returns null if not cached.
 */
export function readDeclaration(rootDir: string, sourcePath: string): string | null {
  const rel = relative(rootDir, sourcePath).replace(/\.tsx?$/, ".d.ts");
  const declPath = join(rootDir, DECL_DIR, rel);
  if (!existsSync(declPath)) return null;
  return readFileSync(declPath, "utf-8");
}
```

**Step 4: Run tests**

Run: `cd packages/kart && bun test src/core/DeclCache.test.ts`
Expected: PASS (requires `tsc` available — should be in devDeps via root typescript)

**Step 5: Commit**

```bash
git add packages/kart/src/core/DeclCache.ts packages/kart/src/core/DeclCache.test.ts
git commit -m "feat(kart): add DeclCache for tsc declaration generation and caching"
```

---

### Task 3: Type reference extraction for BFS traversal

**Files:**
- Create: `packages/kart/src/core/TypeRefs.ts`
- Create: `packages/kart/src/core/TypeRefs.test.ts`

Pure module that parses `.d.ts` content and extracts referenced type names and their source files.

**Step 1: Write the failing test**

```typescript
import { describe, expect, test } from "bun:test";
import { extractTypeReferences, resolveTypeOrigins } from "./TypeRefs.js";

describe("extractTypeReferences", () => {
  test("extracts param and return type references", () => {
    const dts = `
import type { Point } from "./math.js";
export declare function distance(a: Point, b: Point): number;
`;
    const refs = extractTypeReferences(dts, false);
    expect(refs).toContain("Point");
    expect(refs).not.toContain("number"); // primitive
  });

  test("extracts extends/implements references", () => {
    const dts = `
import type { Base } from "./base.js";
export declare class Foo extends Base {
    bar(): string;
}
`;
    const refs = extractTypeReferences(dts, false);
    expect(refs).toContain("Base");
  });

  test("extracts property type references", () => {
    const dts = `
import type { Color } from "./color.js";
export interface Shape {
    color: Color;
    size: number;
}
`;
    const refs = extractTypeReferences(dts, false);
    expect(refs).toContain("Color");
    expect(refs).not.toContain("number");
  });

  test("deep mode includes generic type params", () => {
    const dts = `
import type { Schema } from "./schema.js";
export declare function parse<T extends Schema>(input: string): T;
`;
    const shallow = extractTypeReferences(dts, false);
    expect(shallow).toContain("Schema"); // in extends constraint, visible even shallow

    const deep = extractTypeReferences(dts, true);
    expect(deep).toContain("Schema");
  });

  test("ignores built-in types", () => {
    const dts = `
export declare function foo(a: string, b: number, c: boolean): void;
export declare const bar: Array<string>;
export declare const baz: Promise<void>;
export declare const qux: Record<string, number>;
export declare const quux: Map<string, Set<number>>;
`;
    const refs = extractTypeReferences(dts, false);
    expect(refs).toHaveLength(0);
  });
});

describe("resolveTypeOrigins", () => {
  test("maps type names to their import source files", () => {
    const dts = `
import type { Point } from "./math.js";
import type { Color, Stroke } from "./style.js";
export declare function draw(p: Point, c: Color): void;
`;
    const origins = resolveTypeOrigins(dts);
    expect(origins.get("Point")).toBe("./math.js");
    expect(origins.get("Color")).toBe("./style.js");
    expect(origins.get("Stroke")).toBe("./style.js");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/kart && bun test src/core/TypeRefs.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```typescript
const BUILTIN_TYPES = new Set([
  "string", "number", "boolean", "void", "undefined", "null", "never", "any", "unknown", "object",
  "bigint", "symbol", "Array", "Promise", "Record", "Map", "Set", "WeakMap", "WeakSet",
  "ReadonlyArray", "Readonly", "Partial", "Required", "Pick", "Omit", "Exclude", "Extract",
  "NonNullable", "ReturnType", "Parameters", "InstanceType", "ConstructorParameters",
  "Awaited", "Function", "Date", "RegExp", "Error", "TypeError", "RangeError",
]);

/**
 * Extract non-builtin type references from a .d.ts file.
 * Shallow mode: signature-level references (params, returns, extends, property types).
 * Deep mode: also includes generic constraints, conditional types, mapped types.
 */
export function extractTypeReferences(dts: string, deep: boolean): string[] {
  const refs = new Set<string>();

  // Match type identifiers: capitalized words that appear in type positions
  // This regex catches: Foo, Point, Schema — but not string, number, etc.
  const typePattern = /(?::\s*|extends\s+|implements\s+|<|,\s*)([A-Z][A-Za-z0-9_]*)/g;
  let match;
  while ((match = typePattern.exec(dts)) !== null) {
    const name = match[1];
    if (!BUILTIN_TYPES.has(name)) refs.add(name);
  }

  // Also match import type names as potential references
  const importPattern = /import\s+type\s*\{([^}]+)\}\s*from/g;
  while ((match = importPattern.exec(dts)) !== null) {
    for (const name of match[1].split(",").map((s) => s.trim())) {
      if (name && !BUILTIN_TYPES.has(name)) refs.add(name);
    }
  }

  if (!deep) {
    // In shallow mode, only keep refs that appear in import statements
    // (they're the cross-file references we want to follow)
    const imported = resolveTypeOrigins(dts);
    return [...refs].filter((r) => imported.has(r));
  }

  return [...refs];
}

/**
 * Map type names to their import source specifiers.
 */
export function resolveTypeOrigins(dts: string): Map<string, string> {
  const origins = new Map<string, string>();
  const importPattern = /import\s+type\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/g;
  let match;
  while ((match = importPattern.exec(dts)) !== null) {
    const specifier = match[2];
    for (const name of match[1].split(",").map((s) => s.trim())) {
      if (name) origins.set(name, specifier);
    }
  }
  return origins;
}
```

**Step 4: Run tests**

Run: `cd packages/kart && bun test src/core/TypeRefs.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/kart/src/core/TypeRefs.ts packages/kart/src/core/TypeRefs.test.ts
git commit -m "feat(kart): add TypeRefs for BFS type-graph extraction from .d.ts"
```

---

### Task 4: Update zoom handler — new API params + DeclCache integration

**Files:**
- Modify: `packages/kart/src/Tools.ts:47-70` (tool definition)
- Modify: `packages/kart/src/Symbols.ts:200-278` (zoom handler)
- Modify: `packages/kart/src/Symbols.ts:870-985` (directory zoom + formatter)

This is the biggest task — wires DeclCache into the zoom handler and replaces the API.

**Step 1: Update tool definition in Tools.ts**

Replace kart_zoom (lines 47-70):

```typescript
export const kart_zoom = {
  name: "kart_zoom",
  description:
    "Progressive disclosure of a file or directory via type declarations. Returns .d.ts content for TypeScript files (tsc-generated with full type inference). Depth controls BFS traversal of the type dependency graph: 0 = this file only, 1 = + referenced types, 2 = two hops.",
  annotations: READ_ONLY,
  inputSchema: {
    path: z.string().describe("File or directory path"),
    depth: z
      .number()
      .min(0)
      .max(2)
      .optional()
      .describe("BFS hops through type dependency graph. 0 = this file, 1 = + referenced types, 2 = two hops. Default: 0"),
    visibility: z
      .enum(["exported", "all"])
      .optional()
      .describe('Filter by symbol visibility. Default: "exported"'),
    kind: z
      .array(z.string())
      .optional()
      .describe('Filter by symbol kind: "function", "class", "interface", "type", etc.'),
    deep: z
      .boolean()
      .optional()
      .describe("Follow full type graph including generics, constraints, mapped types. Default: false"),
  },
  handler: (args: {
    path: string;
    depth?: number;
    visibility?: "exported" | "all";
    kind?: string[];
    deep?: boolean;
  }) =>
    Effect.gen(function* () {
      const idx = yield* SymbolIndex;
      return yield* idx.zoom(args.path, {
        depth: args.depth ?? 0,
        visibility: args.visibility ?? "exported",
        kind: args.kind,
        deep: args.deep ?? false,
      });
    }),
} as const;
```

**Step 2: Update SymbolIndex service interface**

In `Symbols.ts`, update the zoom method signature on the `SymbolIndex` Context.Tag:

```typescript
zoom: (
  path: string,
  opts: { depth: number; visibility: "exported" | "all"; kind?: string[]; deep: boolean },
) => Effect.Effect<ZoomResult, FileNotFoundError | LspError | LspTimeoutError>
```

**Step 3: Rewrite zoom handler implementation**

Replace the zoom handler in `SymbolIndexLive` (lines 208-278). Key changes:
- For TS files: use `buildDeclarations` + `readDeclaration` from DeclCache
- For `depth > 0`: use `extractTypeReferences` + `resolveTypeOrigins` to BFS
- For Rust files: keep tree-sitter path with new filter params
- Drop level 2 (raw content) entirely
- Apply `visibility` and `kind` filters

**Step 4: Update directory zoom**

Rewrite `zoomDirectory` to accept the new options. Level 0 compact mode (oxc export counts) maps to `depth=0` directory zoom. Level 1+ maps to `depth=1+` with per-file declarations.

**Step 5: Update formatter**

Rewrite `formatZoomPlaintext` to:
- For TS files: output the `.d.ts` content directly (it IS the plaintext)
- For depth > 0: concatenate referenced file `.d.ts` content with file header comments
- For Rust: keep current signature-based format with new filters applied
- For directories: keep compact format at depth 0, per-file declarations at depth 1+

**Step 6: Verify build**

Run: `cd packages/kart && bun run build`
Expected: PASS

**Step 7: Commit**

```bash
git add packages/kart/src/Tools.ts packages/kart/src/Symbols.ts
git commit -m "feat(kart): rewrite zoom handler with depth-based BFS and DeclCache"
```

---

### Task 5: Update MCP registration

**Files:**
- Modify: `packages/kart/src/Mcp.ts:376-404`

**Step 1: Update kart_zoom registration**

The MCP registration needs to pass new args and handle the updated ZoomResult. The formatter changes from Task 4 handle output.

```typescript
server.registerTool(
  kart_zoom.name,
  {
    description: kart_zoom.description,
    inputSchema: kart_zoom.inputSchema,
    annotations: kart_zoom.annotations,
  },
  async (args: Record<string, unknown>) => {
    try {
      const typedArgs = args as {
        path: string;
        depth?: number;
        visibility?: "exported" | "all";
        kind?: string[];
        deep?: boolean;
      };
      const runtime = await Effect.runPromise(lspRuntimes.runtimeFor(typedArgs.path));
      const result = (await runtime.runPromise(
        kart_zoom.handler(typedArgs) as Effect.Effect<ZoomResult, never, never>,
      )) as ZoomResult;
      const text = formatZoomPlaintext(result, rootDir);
      return {
        content: [{ type: "text" as const, text }],
      };
    } catch (e) {
      const unavailable = getPluginUnavailableError(e);
      if (unavailable) return pluginUnavailableResponse(unavailable);
      return {
        isError: true,
        content: [{ type: "text" as const, text: `Error: ${errorMessage(e)}` }],
      };
    }
  },
);
```

**Step 2: Verify build**

Run: `cd packages/kart && bun run build`
Expected: PASS

**Step 3: Commit**

```bash
git add packages/kart/src/Mcp.ts
git commit -m "refactor(kart): update MCP zoom registration for new API params"
```

---

### Task 6: Rewrite integration tests

**Files:**
- Modify: `packages/kart/src/Symbols.integration.test.ts:61-274`
- Modify: `packages/kart/src/Mcp.integration.test.ts:698-725`

**Step 1: Rewrite zoom integration tests**

Replace all `level`-based tests with `depth`-based equivalents. Key test cases:

1. `depth=0, visibility="exported"`: returns `.d.ts` content with only exported declarations
2. `depth=0, visibility="all"`: returns `.d.ts` with all declarations
3. `depth=1`: returns file `.d.ts` + referenced type files' `.d.ts` content
4. `depth=0, kind=["function"]`: only function declarations
5. `depth=0, deep=true`: includes generic constraint types
6. Directory zoom `depth=0`: file list + export counts (unchanged behavior)
7. Directory zoom `depth=1`: per-file `.d.ts` declarations
8. File not found: same error behavior
9. JSDoc preservation: verify in `.d.ts` output

Drop tests for: level 2 (raw content), resolveTypes param, truncated field.

**Step 2: Rewrite MCP integration tests**

Update the MCP zoom tests to use `depth` parameter and verify `.d.ts` output format.

**Step 3: Run all tests**

Run: `cd packages/kart && bun run test`
Expected: PASS (strict + integration)

**Step 4: Commit**

```bash
git add packages/kart/src/Symbols.integration.test.ts packages/kart/src/Mcp.integration.test.ts
git commit -m "test(kart): rewrite zoom tests for depth-based API with .d.ts output"
```

---

### Task 7: Update skill and hook prompts

**Files:**
- Modify: `packages/kart/skills/zoom.md`
- Modify: `packages/kart/hooks/hooks.json`

**Step 1: Update zoom skill**

Replace `level` references with `depth` semantics. Document:
- `depth=0`: file's exported declarations (`.d.ts` for TS, pub signatures for Rust)
- `depth=1`: + declarations of referenced types (one hop through type graph)
- `depth=2`: two hops
- `visibility`, `kind`, `deep` filters
- No raw content mode — use `Read` for that

**Step 2: Update hook prompts**

If SessionStart or SubagentStart hooks reference zoom levels, update to depth semantics.

**Step 3: Commit**

```bash
git add packages/kart/skills/zoom.md packages/kart/hooks/hooks.json
git commit -m "docs(kart): update zoom skill and hook prompts for new API"
```

---

### Task 8: Add .kart/ to .gitignore

**Files:**
- Modify: `.gitignore` (root) or `packages/kart/.gitignore`

**Step 1: Add .kart/ to gitignore**

```
# kart declaration cache
.kart/
```

**Step 2: Commit**

```bash
git add .gitignore
git commit -m "chore: gitignore .kart/ declaration cache"
```

---

### Task 9: Final validation

**Step 1: Run full check**

Run: `turbo check` (format + lint + build across all packages)
Expected: PASS

**Step 2: Run all tests**

Run: `turbo test`
Expected: PASS

**Step 3: Manual smoke test**

If LSP is available locally, test the MCP server:
- Zoom on a real TypeScript file at depth 0 → should see `.d.ts` content
- Zoom at depth 1 → should see referenced types pulled in
- Zoom on a directory → should see export counts
- Zoom on a Rust file → should see pub signatures (if rust-analyzer available)

---

## Task Dependencies

```
Task 1 (types) ──→ Task 2 (DeclCache) ──→ Task 4 (handler rewrite)
                   Task 3 (TypeRefs)  ──→ Task 4
Task 4 ──→ Task 5 (MCP registration)
Task 4 ──→ Task 6 (tests)
Task 4 ──→ Task 7 (skill/hooks)
Task 8 (.gitignore) — independent
Task 9 (validation) — after all others
```

Tasks 2 and 3 can run in parallel. Tasks 5, 6, 7, 8 can run in parallel after Task 4.
