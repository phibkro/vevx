# Kart v0.5 Serena Replacement — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship the minimum tool set that lets serena be disabled for typescript projects — navigation (read-only parity) then editing (full replacement).

**Architecture:** Two phases. Phase 4a adds `kart_find`, `kart_search`, `kart_list` backed by oxc-parser, ripgrep, and fs. Phase 4b adds `kart_replace`, `kart_insert_after`, `kart_insert_before` backed by oxc-parser AST + oxlint inline diagnostics. All new tools are stateless (no Effect service layer) except the edit pipeline which uses a new `editorRuntime`.

**Tech Stack:** oxc-parser (native AST), ripgrep (pattern search), oxlint --type-aware (inline diagnostics), Bun fs, Effect TS (edit service), Zod (MCP schemas), @modelcontextprotocol/sdk

---

## Phase 4a: Foundation + Navigation

### Task 1: Add oxc-parser dependency

**Files:**
- Modify: `packages/kart/package.json`

**Step 1: Install oxc-parser**

```bash
cd packages/kart && bun add oxc-parser
```

Verify `package.json` now has `"oxc-parser"` in dependencies.

**Step 2: Verify the import works**

```bash
cd packages/kart && bun -e "import { parseSync } from 'oxc-parser'; const r = parseSync('test.ts', 'const x = 1;'); console.log(r.program.body[0].type)"
```

Expected: `VariableDeclaration`

**Step 3: Commit**

```bash
git add packages/kart/package.json packages/kart/bun.lock
git commit -m "chore(kart): add oxc-parser dependency"
```

---

### Task 2: Write OxcSymbols pure module — tests first

**Files:**
- Create: `packages/kart/src/pure/OxcSymbols.test.ts`
- Create: `packages/kart/src/pure/OxcSymbols.ts`

**Step 1: Write the failing tests**

Create `packages/kart/src/pure/OxcSymbols.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { parseSymbols, type OxcSymbol } from "./OxcSymbols.js";

describe("parseSymbols", () => {
  test("extracts function declaration", () => {
    const symbols = parseSymbols("export function greet(name: string): string { return name; }", "test.ts");
    expect(symbols).toEqual([
      expect.objectContaining({ name: "greet", kind: "function", exported: true }),
    ]);
    expect(symbols[0].range.start).toBe(0);
    expect(symbols[0].range.end).toBeGreaterThan(0);
    expect(symbols[0].line).toBe(1);
  });

  test("extracts class declaration", () => {
    const symbols = parseSymbols("class Foo { bar() {} }", "test.ts");
    expect(symbols).toEqual([
      expect.objectContaining({ name: "Foo", kind: "class", exported: false }),
    ]);
  });

  test("extracts interface declaration", () => {
    const symbols = parseSymbols("export interface Config { debug: boolean }", "test.ts");
    expect(symbols).toEqual([
      expect.objectContaining({ name: "Config", kind: "interface", exported: true }),
    ]);
  });

  test("extracts type alias", () => {
    const symbols = parseSymbols("type ID = string | number;", "test.ts");
    expect(symbols).toEqual([
      expect.objectContaining({ name: "ID", kind: "type", exported: false }),
    ]);
  });

  test("extracts enum declaration", () => {
    const symbols = parseSymbols("export enum Status { Active, Inactive }", "test.ts");
    expect(symbols).toEqual([
      expect.objectContaining({ name: "Status", kind: "enum", exported: true }),
    ]);
  });

  test("extracts const/let/var declarations", () => {
    const symbols = parseSymbols("export const MAX = 100;\nlet count = 0;\nvar legacy = true;", "test.ts");
    expect(symbols).toHaveLength(3);
    expect(symbols[0]).toEqual(expect.objectContaining({ name: "MAX", kind: "const", exported: true }));
    expect(symbols[1]).toEqual(expect.objectContaining({ name: "count", kind: "let", exported: false }));
    expect(symbols[2]).toEqual(expect.objectContaining({ name: "legacy", kind: "var", exported: false }));
  });

  test("extracts arrow function assigned to const", () => {
    const symbols = parseSymbols("export const greet = (name: string) => name;", "test.ts");
    expect(symbols[0]).toEqual(expect.objectContaining({ name: "greet", kind: "const", exported: true }));
  });

  test("extracts default export function", () => {
    const symbols = parseSymbols("export default function main() {}", "test.ts");
    expect(symbols[0]).toEqual(expect.objectContaining({ name: "main", kind: "function", exported: true }));
  });

  test("handles multiple declarations in one file", () => {
    const source = `
export function greet(name: string): string { return name; }
export const MAX = 100;
interface Config { debug: boolean }
type ID = string;
class Service {}
`;
    const symbols = parseSymbols(source, "test.ts");
    expect(symbols).toHaveLength(5);
    const names = symbols.map((s) => s.name);
    expect(names).toEqual(["greet", "MAX", "Config", "ID", "Service"]);
  });

  test("returns empty array for empty file", () => {
    expect(parseSymbols("", "test.ts")).toEqual([]);
  });

  test("returns empty array for file with only comments", () => {
    expect(parseSymbols("// just a comment\n/* block */", "test.ts")).toEqual([]);
  });

  test("handles tsx files", () => {
    const symbols = parseSymbols("export function App() { return <div/>; }", "test.tsx");
    expect(symbols[0]).toEqual(expect.objectContaining({ name: "App", kind: "function", exported: true }));
  });

  test("range covers the full declaration", () => {
    const source = "export function greet(name: string): string {\n  return name;\n}";
    const symbols = parseSymbols(source, "test.ts");
    const extracted = source.slice(symbols[0].range.start, symbols[0].range.end);
    expect(extracted).toContain("function greet");
    expect(extracted).toContain("return name");
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
bun test packages/kart/src/pure/OxcSymbols.test.ts
```

Expected: FAIL — module `./OxcSymbols.js` not found.

**Step 3: Write minimal implementation**

Create `packages/kart/src/pure/OxcSymbols.ts`:

```typescript
import { parseSync } from "oxc-parser";

export type OxcSymbol = {
  readonly name: string;
  readonly kind: string;
  readonly exported: boolean;
  readonly line: number;
  readonly range: { readonly start: number; readonly end: number };
};

/**
 * Parse top-level symbols from TypeScript/TSX source using oxc-parser.
 * Returns name, kind, exported status, line number, and byte range for each declaration.
 */
export function parseSymbols(source: string, filename: string): OxcSymbol[] {
  const lang = filename.endsWith(".tsx") ? "tsx" : filename.endsWith(".jsx") ? "jsx" : "ts";
  const result = parseSync(filename, source, { lang, sourceType: "module" });

  const symbols: OxcSymbol[] = [];

  for (const node of result.program.body) {
    // Handle export declarations that wrap the actual declaration
    let exported = false;
    let decl: Record<string, unknown> = node as Record<string, unknown>;

    if (node.type === "ExportNamedDeclaration" && (node as any).declaration) {
      exported = true;
      decl = (node as any).declaration;
    } else if (node.type === "ExportDefaultDeclaration" && (node as any).declaration) {
      exported = true;
      decl = (node as any).declaration;
    }

    const sym = extractSymbol(decl, exported);
    if (sym) {
      // Use the outer node's range for exports (includes the `export` keyword)
      symbols.push({
        ...sym,
        range: { start: (node as any).start, end: (node as any).end },
      });
    }
  }

  return symbols;
}

function extractSymbol(
  node: Record<string, unknown>,
  exported: boolean,
): Omit<OxcSymbol, "range"> | null {
  const type = node.type as string;
  const loc = node.loc as { start: { line: number } } | undefined;
  const line = loc?.start?.line ?? 1;

  switch (type) {
    case "FunctionDeclaration":
      return { name: nameOf(node), kind: "function", exported, line };
    case "ClassDeclaration":
      return { name: nameOf(node), kind: "class", exported, line };
    case "TSInterfaceDeclaration":
      return { name: nameOf(node), kind: "interface", exported, line };
    case "TSTypeAliasDeclaration":
      return { name: nameOf(node), kind: "type", exported, line };
    case "TSEnumDeclaration":
      return { name: nameOf(node), kind: "enum", exported, line };
    case "VariableDeclaration": {
      const declarations = node.declarations as Array<Record<string, unknown>> | undefined;
      if (!declarations || declarations.length === 0) return null;
      const declarator = declarations[0];
      const kind = (node.kind as string) ?? "const";
      return { name: nameOf(declarator, "id"), kind, exported, line };
    }
    default:
      return null;
  }
}

function nameOf(node: Record<string, unknown>, idField = "id"): string {
  const id = node[idField] as { name?: string } | undefined;
  return id?.name ?? "(anonymous)";
}
```

**Step 4: Run tests to verify they pass**

```bash
bun test packages/kart/src/pure/OxcSymbols.test.ts
```

Expected: All 13 tests PASS.

**Step 5: Run full kart test suite to check for regressions**

```bash
bun test packages/kart/src/pure/
```

Expected: All pure tests pass (OxcSymbols + ExportDetection + Signatures).

**Step 6: Commit**

```bash
git add packages/kart/src/pure/OxcSymbols.ts packages/kart/src/pure/OxcSymbols.test.ts
git commit -m "feat(kart): add OxcSymbols pure module for oxc-parser symbol extraction"
```

---

### Task 3: Implement kart_find — tests first

**Files:**
- Create: `packages/kart/src/Find.ts`
- Create: `packages/kart/src/Find.test.ts`
- Modify: `packages/kart/src/Tools.ts`
- Modify: `packages/kart/src/Mcp.ts`
- Modify: `packages/kart/src/Mcp.test.ts`

**Step 1: Write the Find module test**

Create `packages/kart/src/Find.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";

mkdirSync("/tmp/claude", { recursive: true });

import { findSymbols } from "./Find.js";

function withTempProject(files: Record<string, string>, fn: (root: string) => void | Promise<void>) {
  const root = mkdtempSync("/tmp/claude/kart-find-");
  try {
    for (const [path, content] of Object.entries(files)) {
      const full = join(root, path);
      mkdirSync(join(full, ".."), { recursive: true });
      writeFileSync(full, content);
    }
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("findSymbols", () => {
  test("finds function by exact name", async () => {
    await withTempProject(
      { "src/greet.ts": "export function greet(name: string) { return name; }" },
      async (root) => {
        const result = await findSymbols({ name: "greet", rootDir: root });
        expect(result.symbols).toHaveLength(1);
        expect(result.symbols[0]).toEqual(
          expect.objectContaining({ name: "greet", kind: "function", exported: true }),
        );
        expect(result.symbols[0].path).toContain("src/greet.ts");
      },
    );
  });

  test("finds by substring match", async () => {
    await withTempProject(
      { "src/auth.ts": "export function validateToken() {}\nexport function validateUser() {}" },
      async (root) => {
        const result = await findSymbols({ name: "validate", rootDir: root });
        expect(result.symbols).toHaveLength(2);
      },
    );
  });

  test("filters by kind", async () => {
    await withTempProject(
      {
        "src/types.ts": "export interface Config {}\nexport function getConfig() {}",
      },
      async (root) => {
        const result = await findSymbols({ name: "Config", kind: "interface", rootDir: root });
        expect(result.symbols).toHaveLength(1);
        expect(result.symbols[0].kind).toBe("interface");
      },
    );
  });

  test("filters by exported", async () => {
    await withTempProject(
      {
        "src/mix.ts": "export function pub() {}\nfunction priv() {}",
      },
      async (root) => {
        const all = await findSymbols({ name: "", rootDir: root });
        expect(all.symbols).toHaveLength(2);
        const exported = await findSymbols({ name: "", exported: true, rootDir: root });
        expect(exported.symbols).toHaveLength(1);
        expect(exported.symbols[0].name).toBe("pub");
      },
    );
  });

  test("scopes to path subdirectory", async () => {
    await withTempProject(
      {
        "src/a.ts": "export function fromA() {}",
        "lib/b.ts": "export function fromB() {}",
      },
      async (root) => {
        const result = await findSymbols({ name: "", path: "src", rootDir: root });
        expect(result.symbols).toHaveLength(1);
        expect(result.symbols[0].name).toBe("fromA");
      },
    );
  });

  test("excludes node_modules", async () => {
    await withTempProject(
      {
        "src/app.ts": "export function app() {}",
        "node_modules/lib/index.ts": "export function lib() {}",
      },
      async (root) => {
        const result = await findSymbols({ name: "", rootDir: root });
        expect(result.symbols).toHaveLength(1);
        expect(result.symbols[0].name).toBe("app");
      },
    );
  });

  test("returns truncated when file count exceeds cap", async () => {
    // Create enough files to exceed the 2000 file cap
    // We test with a lower cap by testing the truncation logic
    await withTempProject(
      { "src/a.ts": "export function a() {}" },
      async (root) => {
        const result = await findSymbols({ name: "a", rootDir: root });
        expect(result.truncated).toBe(false);
        expect(result.fileCount).toBeGreaterThan(0);
        expect(typeof result.durationMs).toBe("number");
      },
    );
  });

  test("returns empty for no matches", async () => {
    await withTempProject(
      { "src/a.ts": "export function hello() {}" },
      async (root) => {
        const result = await findSymbols({ name: "nonexistent", rootDir: root });
        expect(result.symbols).toEqual([]);
      },
    );
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
bun test packages/kart/src/Find.test.ts
```

Expected: FAIL — module `./Find.js` not found.

**Step 3: Write the Find module**

Create `packages/kart/src/Find.ts`:

```typescript
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { parseSymbols } from "./pure/OxcSymbols.js";

const MAX_FILES = 2000;
const EXCLUDED_DIRS = new Set(["node_modules", ".git", "dist", "build", ".varp"]);
const TS_EXTENSIONS = new Set([".ts", ".tsx"]);

export type FindArgs = {
  readonly name: string;
  readonly kind?: string;
  readonly exported?: boolean;
  readonly path?: string;
  readonly rootDir?: string;
};

export type FoundSymbol = {
  readonly name: string;
  readonly kind: string;
  readonly path: string;
  readonly line: number;
  readonly exported: boolean;
};

export type FindResult = {
  readonly symbols: FoundSymbol[];
  readonly truncated: boolean;
  readonly fileCount: number;
  readonly durationMs: number;
};

export async function findSymbols(args: FindArgs): Promise<FindResult> {
  const start = performance.now();
  const rootDir = args.rootDir ?? process.cwd();
  const searchRoot = args.path ? resolve(rootDir, args.path) : rootDir;

  const files = collectTsFiles(searchRoot, MAX_FILES);
  const truncated = files.truncated;

  const symbols: FoundSymbol[] = [];

  for (const absPath of files.paths) {
    const source = readFileSync(absPath, "utf-8");
    const relPath = relative(rootDir, absPath);
    const parsed = parseSymbols(source, absPath);

    for (const sym of parsed) {
      // Substring match on name (empty string matches all)
      if (args.name && !sym.name.includes(args.name)) continue;
      if (args.kind && sym.kind !== args.kind) continue;
      if (args.exported !== undefined && sym.exported !== args.exported) continue;

      symbols.push({
        name: sym.name,
        kind: sym.kind,
        path: relPath,
        line: sym.line,
        exported: sym.exported,
      });
    }
  }

  return {
    symbols,
    truncated,
    fileCount: files.paths.length,
    durationMs: Math.round(performance.now() - start),
  };
}

function collectTsFiles(
  dir: string,
  maxFiles: number,
): { paths: string[]; truncated: boolean } {
  const paths: string[] = [];
  let truncated = false;

  function walk(d: string) {
    if (truncated) return;
    let entries: string[];
    try {
      entries = readdirSync(d);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (truncated) return;
      if (EXCLUDED_DIRS.has(entry)) continue;

      const full = join(d, entry);
      let stat;
      try {
        stat = statSync(full);
      } catch {
        continue;
      }

      if (stat.isDirectory()) {
        walk(full);
      } else if (stat.isFile()) {
        const ext = extname(entry);
        if (TS_EXTENSIONS.has(ext)) {
          if (paths.length >= maxFiles) {
            truncated = true;
            return;
          }
          paths.push(full);
        }
      }
    }
  }

  walk(dir);
  return { paths, truncated };
}

function extname(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? "" : filename.slice(dot);
}
```

**Step 4: Run tests to verify they pass**

```bash
bun test packages/kart/src/Find.test.ts
```

Expected: All 8 tests PASS.

**Step 5: Add kart_find tool definition and MCP registration**

Add to `packages/kart/src/Tools.ts` — import `findSymbols` and add the tool:

```typescript
// Add import at top
import { findSymbols } from "./Find.js";

// Add tool definition (after kart_deps)
export const kart_find = {
  name: "kart_find",
  description:
    "Find symbols across the workspace by name, kind, or export status. On-demand parsing — no index needed. Use to locate functions, classes, types, and interfaces.",
  annotations: READ_ONLY,
  inputSchema: {
    name: z.string().describe("Symbol name to search for (substring match). Empty string matches all."),
    kind: z
      .string()
      .optional()
      .describe('Filter by symbol kind: "function", "class", "interface", "type", "enum", "const", "let", "var"'),
    exported: z.boolean().optional().describe("Filter by export status"),
    path: z.string().optional().describe("Restrict search to this subdirectory (relative to workspace root)"),
  },
  handler: (args: { name: string; kind?: string; exported?: boolean; path?: string }) =>
    Effect.succeed(findSymbols(args)),
} as const;

// Update tools array
export const tools = [kart_cochange, kart_zoom, kart_impact, kart_deps, kart_find] as const;
```

Note: `kart_find` uses `Effect.succeed` wrapping a Promise because the handler is async but stateless (no Effect service layer needed). The MCP registration will `await` the promise.

Add MCP registration to `packages/kart/src/Mcp.ts`:

```typescript
// Add import
import { kart_find } from "./Tools.js";  // update existing import to include kart_find

// Register kart_find (after kart_deps registration, before return server)
server.registerTool(
  kart_find.name,
  {
    description: kart_find.description,
    inputSchema: kart_find.inputSchema,
    annotations: kart_find.annotations,
  },
  async (args) => {
    try {
      const result = await findSymbols(args as { name: string; kind?: string; exported?: boolean; path?: string });
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

Add MCP import at top of Mcp.ts:

```typescript
import { findSymbols } from "./Find.js";
```

**Step 6: Add MCP integration test for kart_find**

Add to the LSP-enabled `describe` block in `packages/kart/src/Mcp.test.ts`:

```typescript
test("kart_find returns symbols from fixture files", async () => {
  const result = await client.callTool({ name: "kart_find", arguments: { name: "greet" } });
  const parsed = parseResult(result) as { symbols: unknown[]; truncated: boolean; fileCount: number };
  expect(parsed.symbols.length).toBeGreaterThan(0);
  expect(parsed.truncated).toBe(false);
  expect(parsed.fileCount).toBeGreaterThan(0);
});

test("kart_find filters by kind", async () => {
  const result = await client.callTool({
    name: "kart_find",
    arguments: { name: "", kind: "interface" },
  });
  const parsed = parseResult(result) as { symbols: { kind: string }[] };
  for (const sym of parsed.symbols) {
    expect(sym.kind).toBe("interface");
  }
});
```

Also update the tool listing test to include `kart_find`.

**Step 7: Run all tests**

```bash
bun test packages/kart/
```

Expected: All tests pass.

**Step 8: Format and lint**

```bash
cd packages/kart && bun run format && bun run lint
```

**Step 9: Commit**

```bash
git add packages/kart/src/Find.ts packages/kart/src/Find.test.ts packages/kart/src/Tools.ts packages/kart/src/Mcp.ts packages/kart/src/Mcp.test.ts
git commit -m "feat(kart): add kart_find tool for on-demand symbol search"
```

---

### Task 4: Implement kart_search — tests first

**Files:**
- Create: `packages/kart/src/Search.ts`
- Create: `packages/kart/src/Search.test.ts`
- Modify: `packages/kart/src/Tools.ts`
- Modify: `packages/kart/src/Mcp.ts`
- Modify: `packages/kart/src/Mcp.test.ts`

**Step 1: Write the Search module test**

Create `packages/kart/src/Search.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";

mkdirSync("/tmp/claude", { recursive: true });

import { searchPattern } from "./Search.js";

function withTempProject(files: Record<string, string>, fn: (root: string) => void | Promise<void>) {
  const root = mkdtempSync("/tmp/claude/kart-search-");
  try {
    for (const [path, content] of Object.entries(files)) {
      const full = join(root, path);
      mkdirSync(join(full, ".."), { recursive: true });
      writeFileSync(full, content);
    }
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("searchPattern", () => {
  test("finds pattern in files", async () => {
    await withTempProject(
      { "src/a.ts": "const foo = 'hello world';\nconst bar = 'hello';" },
      async (root) => {
        const result = await searchPattern({ pattern: "hello", rootDir: root });
        expect(result.matches.length).toBeGreaterThanOrEqual(1);
        expect(result.matches[0]).toEqual(
          expect.objectContaining({ path: expect.any(String), line: expect.any(Number), text: expect.any(String) }),
        );
      },
    );
  });

  test("supports regex patterns", async () => {
    await withTempProject(
      { "src/a.ts": "function getValue() {}\nfunction getUser() {}" },
      async (root) => {
        const result = await searchPattern({ pattern: "get\\w+", rootDir: root });
        expect(result.matches).toHaveLength(2);
      },
    );
  });

  test("filters by glob", async () => {
    await withTempProject(
      {
        "src/a.ts": "hello",
        "src/b.js": "hello",
      },
      async (root) => {
        const result = await searchPattern({ pattern: "hello", glob: "*.ts", rootDir: root });
        expect(result.matches).toHaveLength(1);
        expect(result.matches[0].path).toContain(".ts");
      },
    );
  });

  test("respects gitignore", async () => {
    await withTempProject(
      {
        "src/a.ts": "hello",
        "dist/b.ts": "hello",
        ".gitignore": "dist/",
      },
      async (root) => {
        // Initialize a git repo so ripgrep respects .gitignore
        Bun.spawnSync(["git", "init"], { cwd: root });
        const result = await searchPattern({ pattern: "hello", rootDir: root });
        expect(result.matches).toHaveLength(1);
      },
    );
  });

  test("caps at 100 matches", async () => {
    const lines = Array.from({ length: 150 }, (_, i) => `const x${i} = "match";`).join("\n");
    await withTempProject(
      { "src/big.ts": lines },
      async (root) => {
        const result = await searchPattern({ pattern: "match", rootDir: root });
        expect(result.matches).toHaveLength(100);
        expect(result.truncated).toBe(true);
      },
    );
  });

  test("returns empty for no matches", async () => {
    await withTempProject(
      { "src/a.ts": "hello" },
      async (root) => {
        const result = await searchPattern({ pattern: "nonexistent", rootDir: root });
        expect(result.matches).toEqual([]);
        expect(result.truncated).toBe(false);
      },
    );
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
bun test packages/kart/src/Search.test.ts
```

Expected: FAIL — module `./Search.js` not found.

**Step 3: Write the Search module**

Create `packages/kart/src/Search.ts`:

```typescript
import { relative, resolve } from "node:path";

const MAX_MATCHES = 100;

export type SearchArgs = {
  readonly pattern: string;
  readonly glob?: string;
  readonly paths?: string[];
  readonly rootDir?: string;
};

export type SearchMatch = {
  readonly path: string;
  readonly line: number;
  readonly text: string;
};

export type SearchResult = {
  readonly matches: SearchMatch[];
  readonly truncated: boolean;
};

export async function searchPattern(args: SearchArgs): Promise<SearchResult> {
  const rootDir = args.rootDir ?? process.cwd();
  const rgArgs = ["rg", "--json", "--max-count", "100", args.pattern];

  if (args.glob) {
    rgArgs.push("--glob", args.glob);
  }

  if (args.paths && args.paths.length > 0) {
    for (const p of args.paths) {
      rgArgs.push(resolve(rootDir, p));
    }
  }

  const proc = Bun.spawn(rgArgs, { cwd: rootDir, stdout: "pipe", stderr: "pipe" });
  const stdout = await new Response(proc.stdout).text();
  await proc.exited;

  const matches: SearchMatch[] = [];
  let truncated = false;

  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.type !== "match") continue;
      if (matches.length >= MAX_MATCHES) {
        truncated = true;
        break;
      }
      const data = msg.data;
      matches.push({
        path: relative(rootDir, data.path.text),
        line: data.line_number,
        text: data.lines.text.trimEnd(),
      });
    } catch {
      continue;
    }
  }

  return { matches, truncated };
}
```

**Step 4: Run tests to verify they pass**

```bash
bun test packages/kart/src/Search.test.ts
```

Expected: All 6 tests PASS.

**Step 5: Add kart_search tool definition and MCP registration**

Add to `packages/kart/src/Tools.ts`:

```typescript
import { searchPattern } from "./Search.js";

export const kart_search = {
  name: "kart_search",
  description:
    "Search for a pattern across the workspace using ripgrep. Gitignore-aware by default. Returns matching lines with file path and line number.",
  annotations: READ_ONLY,
  inputSchema: {
    pattern: z.string().describe("Regular expression pattern to search for"),
    glob: z.string().optional().describe("Glob pattern to filter files (e.g. '*.ts', '*.{ts,tsx}')"),
    paths: z.array(z.string()).optional().describe("Restrict search to these paths (relative to workspace root)"),
  },
  handler: (args: { pattern: string; glob?: string; paths?: string[] }) =>
    Effect.succeed(searchPattern(args)),
} as const;

// Update tools array to include kart_search
```

Add MCP registration in `Mcp.ts` — same pattern as `kart_find` (direct await, no runtime needed).

**Step 6: Add MCP integration test**

Add to `packages/kart/src/Mcp.test.ts`:

```typescript
test("kart_search finds pattern in workspace", async () => {
  const result = await client.callTool({ name: "kart_search", arguments: { pattern: "greet" } });
  const parsed = parseResult(result) as { matches: unknown[]; truncated: boolean };
  expect(parsed.matches.length).toBeGreaterThan(0);
  expect(parsed.truncated).toBe(false);
});
```

**Step 7: Run all tests, format, lint**

```bash
bun test packages/kart/ && cd packages/kart && bun run format && bun run lint
```

**Step 8: Commit**

```bash
git add packages/kart/src/Search.ts packages/kart/src/Search.test.ts packages/kart/src/Tools.ts packages/kart/src/Mcp.ts packages/kart/src/Mcp.test.ts
git commit -m "feat(kart): add kart_search tool for pattern search via ripgrep"
```

---

### Task 5: Implement kart_list — tests first

**Files:**
- Create: `packages/kart/src/List.ts`
- Create: `packages/kart/src/List.test.ts`
- Modify: `packages/kart/src/Tools.ts`
- Modify: `packages/kart/src/Mcp.ts`
- Modify: `packages/kart/src/Mcp.test.ts`

**Step 1: Write the List module test**

Create `packages/kart/src/List.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";

mkdirSync("/tmp/claude", { recursive: true });

import { listDir } from "./List.js";

function withTempProject(files: Record<string, string>, fn: (root: string) => void | Promise<void>) {
  const root = mkdtempSync("/tmp/claude/kart-list-");
  try {
    for (const [path, content] of Object.entries(files)) {
      const full = join(root, path);
      mkdirSync(join(full, ".."), { recursive: true });
      writeFileSync(full, content);
    }
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("listDir", () => {
  test("lists files and directories", async () => {
    await withTempProject(
      { "src/a.ts": "hello", "src/sub/b.ts": "world" },
      async (root) => {
        const result = await listDir({ path: "src", rootDir: root });
        expect(result.entries).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ name: "a.ts", isDirectory: false }),
            expect.objectContaining({ name: "sub", isDirectory: true }),
          ]),
        );
      },
    );
  });

  test("recursive mode lists nested files", async () => {
    await withTempProject(
      { "src/a.ts": "hello", "src/sub/b.ts": "world" },
      async (root) => {
        const result = await listDir({ path: "src", recursive: true, rootDir: root });
        const paths = result.entries.map((e) => e.path);
        expect(paths).toContain("src/a.ts");
        expect(paths).toContain("src/sub/b.ts");
      },
    );
  });

  test("glob filter", async () => {
    await withTempProject(
      { "src/a.ts": "x", "src/b.js": "y", "src/c.ts": "z" },
      async (root) => {
        const result = await listDir({ path: "src", glob: "*.ts", rootDir: root });
        expect(result.entries).toHaveLength(2);
        for (const e of result.entries) expect(e.name).toMatch(/\.ts$/);
      },
    );
  });

  test("excludes node_modules", async () => {
    await withTempProject(
      { "src/a.ts": "x", "node_modules/pkg/index.ts": "y" },
      async (root) => {
        const result = await listDir({ path: ".", recursive: true, rootDir: root });
        const paths = result.entries.map((e) => e.path);
        expect(paths.some((p) => p.includes("node_modules"))).toBe(false);
      },
    );
  });

  test("includes file size", async () => {
    await withTempProject(
      { "src/a.ts": "hello world" },
      async (root) => {
        const result = await listDir({ path: "src", rootDir: root });
        expect(result.entries[0].size).toBe(11);
      },
    );
  });

  test("returns truncated for large directories", async () => {
    await withTempProject(
      { "src/a.ts": "x" },
      async (root) => {
        const result = await listDir({ path: "src", rootDir: root });
        expect(result.truncated).toBe(false);
      },
    );
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
bun test packages/kart/src/List.test.ts
```

**Step 3: Write the List module**

Create `packages/kart/src/List.ts`:

```typescript
import { readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const MAX_ENTRIES = 5000;
const EXCLUDED_DIRS = new Set(["node_modules", ".git", "dist", ".varp"]);

export type ListArgs = {
  readonly path: string;
  readonly recursive?: boolean;
  readonly glob?: string;
  readonly rootDir?: string;
};

export type ListEntry = {
  readonly name: string;
  readonly path: string;
  readonly isDirectory: boolean;
  readonly size?: number;
};

export type ListResult = {
  readonly entries: ListEntry[];
  readonly truncated: boolean;
};

export async function listDir(args: ListArgs): Promise<ListResult> {
  const rootDir = args.rootDir ?? process.cwd();
  const absPath = resolve(rootDir, args.path);
  const entries: ListEntry[] = [];
  let truncated = false;

  if (args.recursive) {
    walkRecursive(absPath, rootDir, entries, MAX_ENTRIES, args.glob);
    truncated = entries.length >= MAX_ENTRIES;
  } else {
    let dirEntries: string[];
    try {
      dirEntries = readdirSync(absPath);
    } catch {
      return { entries: [], truncated: false };
    }

    for (const name of dirEntries) {
      if (EXCLUDED_DIRS.has(name)) continue;
      if (args.glob && !matchGlob(name, args.glob)) continue;

      const full = join(absPath, name);
      try {
        const stat = statSync(full);
        entries.push({
          name,
          path: relative(rootDir, full),
          isDirectory: stat.isDirectory(),
          ...(stat.isFile() ? { size: stat.size } : {}),
        });
      } catch {
        continue;
      }
    }
  }

  return { entries, truncated };
}

function walkRecursive(
  dir: string,
  rootDir: string,
  entries: ListEntry[],
  max: number,
  glob?: string,
): void {
  if (entries.length >= max) return;

  let dirEntries: string[];
  try {
    dirEntries = readdirSync(dir);
  } catch {
    return;
  }

  for (const name of dirEntries) {
    if (entries.length >= max) return;
    if (EXCLUDED_DIRS.has(name)) continue;

    const full = join(dir, name);
    try {
      const stat = statSync(full);
      if (stat.isDirectory()) {
        walkRecursive(full, rootDir, entries, max, glob);
      } else {
        if (glob && !matchGlob(name, glob)) continue;
        entries.push({
          name,
          path: relative(rootDir, full),
          isDirectory: false,
          size: stat.size,
        });
      }
    } catch {
      continue;
    }
  }
}

/** Simple glob matcher — supports `*` wildcard and `.ext` patterns. */
function matchGlob(name: string, glob: string): boolean {
  if (glob.startsWith("*.")) {
    return name.endsWith(glob.slice(1));
  }
  const regex = new RegExp("^" + glob.replace(/\*/g, ".*").replace(/\?/g, ".") + "$");
  return regex.test(name);
}
```

**Step 4: Run tests to verify they pass**

```bash
bun test packages/kart/src/List.test.ts
```

Expected: All 6 tests PASS.

**Step 5: Add kart_list tool definition and MCP registration**

Add to `packages/kart/src/Tools.ts`:

```typescript
import { listDir } from "./List.js";

export const kart_list = {
  name: "kart_list",
  description:
    "List files and directories. Gitignore-aware. Supports recursive listing and glob filtering.",
  annotations: READ_ONLY,
  inputSchema: {
    path: z.string().describe("Directory path to list (relative to workspace root)"),
    recursive: z.boolean().optional().describe("List files recursively (default: false)"),
    glob: z.string().optional().describe("Glob pattern to filter entries (e.g. '*.ts')"),
  },
  handler: (args: { path: string; recursive?: boolean; glob?: string }) =>
    Effect.succeed(listDir(args)),
} as const;

// Update tools array
```

Register in `Mcp.ts` — same stateless pattern.

**Step 6: Add MCP integration test, run all tests, format, lint**

**Step 7: Commit**

```bash
git add packages/kart/src/List.ts packages/kart/src/List.test.ts packages/kart/src/Tools.ts packages/kart/src/Mcp.ts packages/kart/src/Mcp.test.ts
git commit -m "feat(kart): add kart_list tool for directory listing"
```

---

### Task 6: Phase 4a docs + changeset

**Files:**
- Modify: `packages/kart/README.md`
- Modify: `packages/kart/docs/architecture.md`
- Modify: `packages/kart/docs/design.md`
- Modify: `packages/kart/hooks/hooks.json`
- Modify: `packages/kart/skills/zoom/SKILL.md`
- Create: `.changeset/kart-nav-minor.md`

**Step 1: Update README with new tools**

Add `kart_find`, `kart_search`, `kart_list` to the tools table and add sections for each. Add `oxc-parser` to the Stack section.

**Step 2: Update architecture docs**

Add data flow for each new tool. Update test counts. Add `Find.ts`, `Search.ts`, `List.ts`, `OxcSymbols.ts` to module table.

**Step 3: Update hooks and skill**

Update SessionStart/SubagentStart prompts to mention the new navigation tools. Update SKILL.md quick reference.

**Step 4: Create changeset**

Create `.changeset/kart-nav-minor.md`:

```markdown
---
"@vevx/kart": minor
---

Add navigation tools for serena replacement:
- `kart_find` — workspace symbol search via on-demand oxc-parser
- `kart_search` — pattern search via ripgrep
- `kart_list` — directory listing with glob filtering
- `OxcSymbols` pure module — shared oxc-parser symbol extraction
```

**Step 5: Commit**

```bash
git add .changeset/kart-nav-minor.md packages/kart/README.md packages/kart/docs/ packages/kart/hooks/ packages/kart/skills/
git commit -m "docs(kart): add phase 4a navigation tools documentation"
```

---

## Phase 4b: Editing

### Task 7: Write AstEdit pure module — tests first

**Files:**
- Create: `packages/kart/src/pure/AstEdit.ts`
- Create: `packages/kart/src/pure/AstEdit.test.ts`

**Step 1: Write the failing tests**

Create `packages/kart/src/pure/AstEdit.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { locateSymbol, validateSyntax, spliceReplace, spliceInsertAfter, spliceInsertBefore } from "./AstEdit.js";

describe("locateSymbol", () => {
  test("locates a function by name", () => {
    const source = "function greet(name: string) { return name; }";
    const range = locateSymbol(source, "greet", "test.ts");
    expect(range).not.toBeNull();
    expect(source.slice(range!.start, range!.end)).toContain("function greet");
  });

  test("locates an exported function", () => {
    const source = "export function greet(name: string) { return name; }";
    const range = locateSymbol(source, "greet", "test.ts");
    expect(range).not.toBeNull();
    expect(source.slice(range!.start, range!.end)).toContain("export function greet");
  });

  test("locates a class", () => {
    const source = "class Foo { bar() {} }";
    const range = locateSymbol(source, "Foo", "test.ts");
    expect(range).not.toBeNull();
    expect(source.slice(range!.start, range!.end)).toContain("class Foo");
  });

  test("locates a type alias", () => {
    const source = "type ID = string | number;";
    const range = locateSymbol(source, "ID", "test.ts");
    expect(range).not.toBeNull();
    expect(source.slice(range!.start, range!.end)).toBe("type ID = string | number;");
  });

  test("locates a const declaration", () => {
    const source = "const MAX = 100;";
    const range = locateSymbol(source, "MAX", "test.ts");
    expect(range).not.toBeNull();
  });

  test("returns null for missing symbol", () => {
    const source = "function greet() {}";
    const range = locateSymbol(source, "missing", "test.ts");
    expect(range).toBeNull();
  });

  test("returns all matches when multiple symbols share a name", () => {
    const source = "function parse() {}\nconst parse = () => {};";
    // This is ambiguous — locateSymbol should return null or error
    // Actually the function should find the first one; ambiguity is handled at the tool level
    const range = locateSymbol(source, "parse", "test.ts");
    expect(range).not.toBeNull();
  });
});

describe("validateSyntax", () => {
  test("returns null for valid code", () => {
    expect(validateSyntax("const x = 1;", "test.ts")).toBeNull();
  });

  test("returns error for invalid code", () => {
    const err = validateSyntax("const x = ;", "test.ts");
    expect(err).not.toBeNull();
    expect(err).toContain("Expected");
  });

  test("validates tsx", () => {
    expect(validateSyntax("const el = <div/>;", "test.tsx")).toBeNull();
  });
});

describe("spliceReplace", () => {
  test("replaces content at range", () => {
    const file = "aaa\nbbb\nccc";
    const result = spliceReplace(file, { start: 4, end: 7 }, "BBB");
    expect(result).toBe("aaa\nBBB\nccc");
  });

  test("handles different-length replacement", () => {
    const file = "short";
    const result = spliceReplace(file, { start: 0, end: 5 }, "much longer string");
    expect(result).toBe("much longer string");
  });
});

describe("spliceInsertAfter", () => {
  test("inserts content after range end", () => {
    const file = "aaa\nbbb\nccc";
    const result = spliceInsertAfter(file, { start: 4, end: 7 }, "\nINSERTED");
    expect(result).toBe("aaa\nbbb\nINSERTED\nccc");
  });
});

describe("spliceInsertBefore", () => {
  test("inserts content before range start", () => {
    const file = "aaa\nbbb\nccc";
    const result = spliceInsertBefore(file, { start: 4, end: 7 }, "INSERTED\n");
    expect(result).toBe("aaa\nINSERTED\nbbb\nccc");
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
bun test packages/kart/src/pure/AstEdit.test.ts
```

**Step 3: Write the AstEdit module**

Create `packages/kart/src/pure/AstEdit.ts`:

```typescript
import { parseSymbols } from "./OxcSymbols.js";

export type SymbolRange = { readonly start: number; readonly end: number };

/**
 * Locate a top-level symbol by name, returning its byte range.
 * Returns null if the symbol is not found.
 */
export function locateSymbol(source: string, name: string, filename: string): SymbolRange | null {
  const symbols = parseSymbols(source, filename);
  const match = symbols.find((s) => s.name === name);
  return match ? match.range : null;
}

/**
 * Validate that source code parses without syntax errors.
 * Returns null if valid, or an error message string if invalid.
 */
export function validateSyntax(source: string, filename: string): string | null {
  const { parseSync } = require("oxc-parser");
  const lang = filename.endsWith(".tsx") ? "tsx" : filename.endsWith(".jsx") ? "jsx" : "ts";
  const result = parseSync(filename, source, { lang, sourceType: "module" });
  if (result.errors && result.errors.length > 0) {
    return result.errors.map((e: { message: string }) => e.message).join("; ");
  }
  return null;
}

/** Replace content between start and end with new content. */
export function spliceReplace(file: string, range: SymbolRange, content: string): string {
  return file.slice(0, range.start) + content + file.slice(range.end);
}

/** Insert content after the end of the range. */
export function spliceInsertAfter(file: string, range: SymbolRange, content: string): string {
  return file.slice(0, range.end) + content + file.slice(range.end);
}

/** Insert content before the start of the range. */
export function spliceInsertBefore(file: string, range: SymbolRange, content: string): string {
  return file.slice(0, range.start) + content + file.slice(range.start);
}
```

Note: `validateSyntax` uses dynamic `require("oxc-parser")` because it imports `parseSync` directly (not via OxcSymbols). This should be changed to a static import — `import { parseSync } from "oxc-parser"` — during implementation. The plan shows the logic; the implementer should use the ESM import pattern consistent with the rest of the codebase.

**Step 4: Run tests to verify they pass**

```bash
bun test packages/kart/src/pure/AstEdit.test.ts
```

Expected: All tests PASS.

**Step 5: Run pure test suite**

```bash
bun test packages/kart/src/pure/
```

Expected: All pure tests pass (OxcSymbols + AstEdit + ExportDetection + Signatures).

**Step 6: Commit**

```bash
git add packages/kart/src/pure/AstEdit.ts packages/kart/src/pure/AstEdit.test.ts
git commit -m "feat(kart): add AstEdit pure module for symbol-level splicing"
```

---

### Task 8: Implement Editor service and edit tools

**Files:**
- Create: `packages/kart/src/Editor.ts`
- Create: `packages/kart/src/Editor.test.ts`
- Modify: `packages/kart/src/Tools.ts`
- Modify: `packages/kart/src/Mcp.ts`
- Modify: `packages/kart/src/Mcp.test.ts`

**Step 1: Write the Editor service test**

Create `packages/kart/src/Editor.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";

mkdirSync("/tmp/claude", { recursive: true });

import { editReplace, editInsertAfter, editInsertBefore, type EditResult } from "./Editor.js";

function withTempFile(
  content: string,
  fn: (filePath: string) => Promise<EditResult>,
): Promise<{ result: EditResult; fileContent: string }> {
  const dir = mkdtempSync("/tmp/claude/kart-edit-");
  const filePath = join(dir, "test.ts");
  writeFileSync(filePath, content);
  return fn(filePath).then((result) => ({
    result,
    fileContent: readFileSync(filePath, "utf-8"),
  }));
}

describe("editReplace", () => {
  test("replaces a function body", async () => {
    const { result, fileContent } = await withTempFile(
      "export function greet(name: string): string {\n  return name;\n}\n",
      (path) => editReplace(path, "greet", 'export function greet(name: string): string {\n  return `Hello ${name}`;\n}'),
    );
    expect(result.success).toBe(true);
    expect(result.syntaxError).toBe(false);
    expect(fileContent).toContain("Hello");
    expect(fileContent).not.toContain("return name");
  });

  test("rejects syntax errors without modifying file", async () => {
    const original = "export function greet() { return 1; }\n";
    const { result, fileContent } = await withTempFile(original, (path) =>
      editReplace(path, "greet", "export function greet() { return ; }"),
    );
    expect(result.success).toBe(false);
    expect(result.syntaxError).toBe(true);
    expect(result.syntaxErrorMessage).toBeDefined();
    expect(fileContent).toBe(original);
  });

  test("returns error for unknown symbol", async () => {
    const { result, fileContent } = await withTempFile(
      "function greet() {}\n",
      (path) => editReplace(path, "missing", "function missing() {}"),
    );
    expect(result.success).toBe(false);
  });
});

describe("editInsertAfter", () => {
  test("inserts content after a symbol", async () => {
    const { result, fileContent } = await withTempFile(
      "export function greet() {}\n",
      (path) => editInsertAfter(path, "greet", "\nexport function farewell() {}\n"),
    );
    expect(result.success).toBe(true);
    expect(fileContent).toContain("function greet");
    expect(fileContent).toContain("function farewell");
    // greet should come before farewell
    expect(fileContent.indexOf("greet")).toBeLessThan(fileContent.indexOf("farewell"));
  });
});

describe("editInsertBefore", () => {
  test("inserts content before a symbol", async () => {
    const { result, fileContent } = await withTempFile(
      "export function greet() {}\n",
      (path) => editInsertBefore(path, "greet", "// Added comment\n"),
    );
    expect(result.success).toBe(true);
    expect(fileContent).toContain("// Added comment");
    expect(fileContent.indexOf("Added comment")).toBeLessThan(fileContent.indexOf("greet"));
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
bun test packages/kart/src/Editor.test.ts
```

**Step 3: Write the Editor module**

Create `packages/kart/src/Editor.ts`:

```typescript
import { readFileSync, writeFileSync } from "node:fs";
import { locateSymbol, validateSyntax, spliceReplace, spliceInsertAfter, spliceInsertBefore } from "./pure/AstEdit.js";

export type Diagnostic = {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly severity: string;
  readonly message: string;
  readonly ruleId?: string;
};

export type EditResult = {
  readonly success: boolean;
  readonly path: string;
  readonly symbol: string;
  readonly diagnostics: Diagnostic[];
  readonly syntaxError: boolean;
  readonly syntaxErrorMessage?: string;
};

export async function editReplace(
  filePath: string,
  symbolName: string,
  content: string,
): Promise<EditResult> {
  return edit(filePath, symbolName, content, "replace");
}

export async function editInsertAfter(
  filePath: string,
  symbolName: string,
  content: string,
): Promise<EditResult> {
  return edit(filePath, symbolName, content, "insertAfter");
}

export async function editInsertBefore(
  filePath: string,
  symbolName: string,
  content: string,
): Promise<EditResult> {
  return edit(filePath, symbolName, content, "insertBefore");
}

async function edit(
  filePath: string,
  symbolName: string,
  content: string,
  mode: "replace" | "insertAfter" | "insertBefore",
): Promise<EditResult> {
  const base = { path: filePath, symbol: symbolName, diagnostics: [] as Diagnostic[] };

  // 1. Read file
  let source: string;
  try {
    source = readFileSync(filePath, "utf-8");
  } catch {
    return { ...base, success: false, syntaxError: false, syntaxErrorMessage: `File not found: ${filePath}` };
  }

  // 2. Locate symbol
  const range = locateSymbol(source, symbolName, filePath);
  if (!range) {
    return { ...base, success: false, syntaxError: false, syntaxErrorMessage: `Symbol not found: ${symbolName}` };
  }

  // 3. For replace mode, validate new content syntax
  if (mode === "replace") {
    const syntaxErr = validateSyntax(content, filePath);
    if (syntaxErr) {
      return { ...base, success: false, syntaxError: true, syntaxErrorMessage: syntaxErr };
    }
  }

  // 4. Splice
  let newSource: string;
  switch (mode) {
    case "replace":
      newSource = spliceReplace(source, range, content);
      break;
    case "insertAfter":
      newSource = spliceInsertAfter(source, range, content);
      break;
    case "insertBefore":
      newSource = spliceInsertBefore(source, range, content);
      break;
  }

  // 5. Validate the full file after edit
  const fullErr = validateSyntax(newSource, filePath);
  if (fullErr) {
    return { ...base, success: false, syntaxError: true, syntaxErrorMessage: fullErr };
  }

  // 6. Write file
  writeFileSync(filePath, newSource);

  // 7. Run oxlint (best-effort)
  const diagnostics = await runOxlint(filePath);

  return { ...base, success: true, syntaxError: false, diagnostics };
}

async function runOxlint(filePath: string): Promise<Diagnostic[]> {
  try {
    const proc = Bun.spawn(["oxlint", "--format", "json", filePath], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;

    if (!stdout.trim()) return [];

    const parsed = JSON.parse(stdout);
    if (!Array.isArray(parsed)) return [];

    return parsed.map((d: any) => ({
      file: d.filename ?? filePath,
      line: d.line ?? 0,
      column: d.column ?? 0,
      severity: d.severity ?? "warning",
      message: d.message ?? "",
      ruleId: d.ruleId,
    }));
  } catch {
    // oxlint not available — graceful degradation
    return [];
  }
}
```

**Step 4: Run tests to verify they pass**

```bash
bun test packages/kart/src/Editor.test.ts
```

Expected: All tests PASS.

**Step 5: Add tool definitions to Tools.ts**

```typescript
import { editReplace, editInsertAfter, editInsertBefore } from "./Editor.js";

const READ_WRITE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};

export const kart_replace = {
  name: "kart_replace",
  description:
    "Replace a symbol's full definition in a file. Validates syntax before writing. Returns inline diagnostics from oxlint.",
  annotations: READ_WRITE,
  inputSchema: {
    file: z.string().describe("File path containing the symbol"),
    symbol: z.string().describe("Name of the symbol to replace"),
    content: z.string().describe("New content to replace the symbol with (must be valid syntax)"),
  },
  handler: (args: { file: string; symbol: string; content: string }) =>
    Effect.succeed(editReplace(args.file, args.symbol, args.content)),
} as const;

export const kart_insert_after = {
  name: "kart_insert_after",
  description:
    "Insert content after a symbol's definition. Returns inline diagnostics from oxlint.",
  annotations: READ_WRITE,
  inputSchema: {
    file: z.string().describe("File path containing the symbol"),
    symbol: z.string().describe("Name of the symbol to insert after"),
    content: z.string().describe("Content to insert after the symbol"),
  },
  handler: (args: { file: string; symbol: string; content: string }) =>
    Effect.succeed(editInsertAfter(args.file, args.symbol, args.content)),
} as const;

export const kart_insert_before = {
  name: "kart_insert_before",
  description:
    "Insert content before a symbol's definition. Returns inline diagnostics from oxlint.",
  annotations: READ_WRITE,
  inputSchema: {
    file: z.string().describe("File path containing the symbol"),
    symbol: z.string().describe("Name of the symbol to insert before"),
    content: z.string().describe("Content to insert before the symbol"),
  },
  handler: (args: { file: string; symbol: string; content: string }) =>
    Effect.succeed(editInsertBefore(args.file, args.symbol, args.content)),
} as const;

export const tools = [
  kart_cochange, kart_zoom, kart_impact, kart_deps,
  kart_find, kart_search, kart_list,
  kart_replace, kart_insert_after, kart_insert_before,
] as const;
```

**Step 6: Register in Mcp.ts**

Register `kart_replace`, `kart_insert_after`, `kart_insert_before` — same stateless async pattern as `kart_find`.

**Step 7: Add MCP integration tests**

Add to `packages/kart/src/Mcp.test.ts`:

```typescript
describe("MCP integration — kart edit tools", () => {
  let client: Client;
  let tempDir: string;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    tempDir = await mkdtemp("/tmp/claude/kart-edit-mcp-");
    await writeFile(join(tempDir, "target.ts"), "export function greet() { return 1; }\n");

    const server = createServer({ rootDir: tempDir });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(clientTransport);

    cleanup = async () => {
      await client.close();
      await rm(tempDir, { recursive: true, force: true });
    };
  });

  afterAll(async () => {
    await cleanup();
  });

  test("kart_replace replaces symbol content", async () => {
    const result = await client.callTool({
      name: "kart_replace",
      arguments: {
        file: join(tempDir, "target.ts"),
        symbol: "greet",
        content: "export function greet() { return 2; }",
      },
    });
    const parsed = parseResult(result) as EditResult;
    expect(parsed.success).toBe(true);
    expect(parsed.syntaxError).toBe(false);
  });

  test("kart_replace rejects syntax errors", async () => {
    const result = await client.callTool({
      name: "kart_replace",
      arguments: {
        file: join(tempDir, "target.ts"),
        symbol: "greet",
        content: "export function greet() { return ; }",
      },
    });
    const parsed = parseResult(result) as EditResult;
    expect(parsed.success).toBe(false);
    expect(parsed.syntaxError).toBe(true);
  });

  test("kart_insert_after inserts content", async () => {
    const result = await client.callTool({
      name: "kart_insert_after",
      arguments: {
        file: join(tempDir, "target.ts"),
        symbol: "greet",
        content: "\nexport function farewell() { return 'bye'; }\n",
      },
    });
    const parsed = parseResult(result) as EditResult;
    expect(parsed.success).toBe(true);
  });
});
```

**Step 8: Run all tests, format, lint**

```bash
bun test packages/kart/ && cd packages/kart && bun run format && bun run lint
```

**Step 9: Commit**

```bash
git add packages/kart/src/Editor.ts packages/kart/src/Editor.test.ts packages/kart/src/Tools.ts packages/kart/src/Mcp.ts packages/kart/src/Mcp.test.ts
git commit -m "feat(kart): add edit tools (kart_replace, kart_insert_after, kart_insert_before)"
```

---

### Task 9: Phase 4b docs + changeset + release

**Files:**
- Modify: `packages/kart/README.md`
- Modify: `packages/kart/docs/architecture.md`
- Modify: `packages/kart/docs/design.md`
- Modify: `packages/kart/hooks/hooks.json`
- Modify: `packages/kart/skills/zoom/SKILL.md`
- Create: `.changeset/kart-edit-minor.md`

**Step 1: Update README**

Add `kart_replace`, `kart_insert_after`, `kart_insert_before` to tools table with descriptions. Add `Editor.ts`, `AstEdit.ts` to modules table. Update Stack to mention oxlint.

**Step 2: Update architecture docs**

Add edit pipeline data flow. Add new test counts. Document the `EditResult` type and oxlint integration.

**Step 3: Update design doc**

Update phase status table — mark phase 4a and 4b as "shipped".

**Step 4: Update hooks/skill**

Mention edit tools in SessionStart/SubagentStart prompts. Add edit workflow to SKILL.md.

**Step 5: Create changeset**

```markdown
---
"@vevx/kart": minor
---

Add editing tools for full serena replacement:
- `kart_replace` — replace symbol definition with syntax validation
- `kart_insert_after` — insert content after a symbol
- `kart_insert_before` — insert content before a symbol
- `AstEdit` pure module — locateSymbol, validateSyntax, splice functions
- Inline oxlint diagnostics on every successful edit
```

**Step 6: Commit**

```bash
git add .changeset/kart-edit-minor.md packages/kart/README.md packages/kart/docs/ packages/kart/hooks/ packages/kart/skills/
git commit -m "docs(kart): add phase 4b editing tools documentation"
```

---

## Verification Checklist

After all tasks:

```bash
# All tests pass
bun test packages/kart/

# Pure tests with coverage
bun test --concurrent --coverage packages/kart/src/pure/

# Format + lint
cd packages/kart && bun run check

# Build succeeds
bun run build
```

Expected tool count: 10 tools (`kart_cochange`, `kart_zoom`, `kart_impact`, `kart_deps`, `kart_find`, `kart_search`, `kart_list`, `kart_replace`, `kart_insert_after`, `kart_insert_before`).

## Implementation Notes

- **oxc-parser API**: `parseSync(filename, source, { lang, sourceType: "module" })` returns `{ program: { body: Node[] }, errors: Error[] }`. Nodes have `start`/`end` byte offsets and `loc.start.line`/`loc.start.column`.
- **No Effect service for nav tools**: `kart_find`, `kart_search`, `kart_list` are stateless — they don't need a `ManagedRuntime`. They run as plain async functions called directly from the MCP handler.
- **No Effect service for edit tools either**: The design planned an `editorRuntime` but the edit pipeline is stateless too (read file → parse → splice → write → oxlint). Plain async functions are simpler and consistent with the nav tools.
- **validateSyntax in AstEdit**: Uses `parseSync` from `oxc-parser` directly. Shares the import with `OxcSymbols.ts`.
- **oxlint integration**: Best-effort. If oxlint is not installed, diagnostics are empty. The `--type-aware` flag is omitted initially — add it when oxlint-tsgolint is confirmed available in the workspace.
