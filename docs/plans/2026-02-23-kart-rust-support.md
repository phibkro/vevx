# Kart Rust Support — Phase 1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make `kart_zoom`, `kart_find`, and `kart_list` work for `.rs` files using tree-sitter and rust-analyzer.

**Architecture:** Route by file extension at the tool level. `.ts`/`.tsx` → oxc-parser + typescript-language-server (existing). `.rs` → tree-sitter + rust-analyzer (new). Shared core: LSP JSON-RPC transport, symbol types, mtime cache, graph algorithms.

**Tech Stack:** `web-tree-sitter` (WASM, no native bindings), `tree-sitter-wasms` (prebuilt Rust grammar), `rust-analyzer` (system binary via `Bun.which`)

---

## Conventions

- Runtime: Bun. ESM only. Never `require()`.
- Types: Zod schema first, infer via `z.infer<>`.
- Tests: Co-located `*.test.ts`. `bun test --concurrent`. Use `bun-testing` skill for patterns.
- Format: `oxfmt`. Lint: `oxlint --type-aware`.
- Temp files: `/tmp/claude/` prefix. Guard subprocess tests with `!process.env.TURBO_HASH`.
- Pure code in `src/pure/` — no IO, 100% function coverage enforced.
- Effectful code in `src/` — integration tests without coverage gates.

### Existing files to understand

| File | Purpose | Relevant patterns |
|---|---|---|
| `src/pure/OxcSymbols.ts` | TS symbol extraction via oxc-parser | `OxcSymbol` type, `parseSymbols(source, filename)` signature, `DECLARATION_KINDS` registry |
| `src/pure/AstEdit.ts` | Symbol location + syntax validation + splice | `locateSymbol`, `validateSyntax`, `spliceReplace/After/Before` (language-agnostic) |
| `src/pure/ExportDetection.ts` | LSP zoom export detection via text scan | `isExported(symbol, lines)` checks `line.startsWith("export ")` |
| `src/Find.ts` | Workspace-wide symbol search with mtime cache | `symbolCache`, `clearSymbolCache()`, `TS_EXTENSIONS`, `parseSymbols` call |
| `src/Lsp.ts` | LSP client (JSON-RPC transport + typescript-language-server) | `LspClientLive(config)`, `findLspBinary()`, hardcoded `--stdio`, watcher extensions |
| `src/Symbols.ts` | LSP-backed zoom/impact/deps/refs/rename | `SymbolIndexLive`, `zoomDirectory` filters `.ts`/`.tsx` |
| `src/Mcp.ts` | MCP server, per-tool runtime | `zoomRuntime`, `cochangeRuntime`, `clearSymbolCache()` in restart |

---

## Task 1: Add tree-sitter dependencies

**Files:**
- Modify: `packages/kart/package.json`

**Step 1: Install dependencies**

Run:
```bash
cd packages/kart && bun add web-tree-sitter tree-sitter-wasms
```

**Step 2: Externalize in build script**

In `package.json`, change the build command:
```json
"build": "bun build ./src/Mcp.ts --outdir ./dist --target bun --external oxc-parser --external web-tree-sitter"
```

`tree-sitter-wasms` only provides `.wasm` files — it's not imported in JS, so it doesn't need externalizing.

**Step 3: Verify build works**

Run: `bun run build`
Expected: `Mcp.js` bundles successfully, smaller or similar size.

**Step 4: Commit**

```bash
git add package.json bun.lock
git commit -m "chore(kart): add web-tree-sitter and tree-sitter-wasms dependencies"
```

---

## Task 2: Create `RustSymbols.ts` — Rust symbol extraction

**Files:**
- Create: `packages/kart/src/pure/RustSymbols.ts`
- Test: `packages/kart/src/pure/RustSymbols.test.ts`

### Step 1: Write the failing tests

```typescript
// src/pure/RustSymbols.test.ts
import { describe, expect, test } from "bun:test";
import { parseRustSymbols, initRustParser } from "./RustSymbols.js";

const FIXTURE = `
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
}
`;

describe("parseRustSymbols", () => {
  test("extracts all top-level declarations", async () => {
    await initRustParser();
    const symbols = parseRustSymbols(FIXTURE, "lib.rs");
    const names = symbols.map((s) => s.name);

    expect(names).toContain("greet");
    expect(names).toContain("internal");
    expect(names).toContain("Config");
    expect(names).toContain("Status");
    expect(names).toContain("Greetable");
    expect(names).toContain("Alias");
    expect(names).toContain("MAX");
    expect(names).toContain("GLOBAL");
    expect(names).toContain("inner");
    expect(names).toContain("my_macro");
  });

  test("detects pub vs private", async () => {
    await initRustParser();
    const symbols = parseRustSymbols(FIXTURE, "lib.rs");
    const exported = (name: string) => symbols.find((s) => s.name === name)?.exported;

    expect(exported("greet")).toBe(true);
    expect(exported("internal")).toBe(false);
    expect(exported("Config")).toBe(true);
    expect(exported("Status")).toBe(true);
    expect(exported("Greetable")).toBe(false); // no pub
    expect(exported("Alias")).toBe(true);
    expect(exported("MAX")).toBe(true);
    expect(exported("GLOBAL")).toBe(true);
    expect(exported("inner")).toBe(false); // no pub
    expect(exported("my_macro")).toBe(false); // no pub
  });

  test("assigns correct kinds", async () => {
    await initRustParser();
    const symbols = parseRustSymbols(FIXTURE, "lib.rs");
    const kind = (name: string) => symbols.find((s) => s.name === name)?.kind;

    expect(kind("greet")).toBe("function");
    expect(kind("Config")).toBe("struct");
    expect(kind("Status")).toBe("enum");
    expect(kind("Greetable")).toBe("trait");
    expect(kind("Alias")).toBe("type");
    expect(kind("MAX")).toBe("const");
    expect(kind("GLOBAL")).toBe("static");
    expect(kind("inner")).toBe("mod");
    expect(kind("my_macro")).toBe("macro");
  });

  test("names impl blocks with type", async () => {
    await initRustParser();
    const symbols = parseRustSymbols(FIXTURE, "lib.rs");
    const impls = symbols.filter((s) => s.kind === "impl");

    expect(impls).toHaveLength(2);
    const implNames = impls.map((s) => s.name).sort();
    expect(implNames).toEqual(["Greetable for Config", "Config"].sort());
  });

  test("includes line numbers and byte ranges", async () => {
    await initRustParser();
    const symbols = parseRustSymbols(FIXTURE, "lib.rs");
    const greet = symbols.find((s) => s.name === "greet")!;

    expect(greet.line).toBeGreaterThan(0);
    expect(greet.range.start).toBeGreaterThan(0);
    expect(greet.range.end).toBeGreaterThan(greet.range.start);
  });

  test("handles empty source", async () => {
    await initRustParser();
    const symbols = parseRustSymbols("", "empty.rs");
    expect(symbols).toEqual([]);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test src/pure/RustSymbols.test.ts`
Expected: FAIL — module `./RustSymbols.js` not found.

### Step 3: Implement `RustSymbols.ts`

```typescript
// src/pure/RustSymbols.ts
/**
 * Symbol extraction from Rust source using web-tree-sitter.
 *
 * Parses top-level declarations and produces a flat list of symbols
 * with name, kind, export status, line number, and byte range.
 *
 * Pure function — no LSP or Effect dependency. Requires `initRustParser()`
 * to be called once before use (loads WASM grammar).
 */

import Parser from "web-tree-sitter";
import { resolve } from "node:path";
import type { OxcSymbol } from "./OxcSymbols.js";

// ── Parser lifecycle ──

let rustParser: Parser | null = null;

/** Initialize the tree-sitter Rust parser. Idempotent — safe to call multiple times. */
export async function initRustParser(): Promise<void> {
  if (rustParser) return;
  await Parser.init();
  const parser = new Parser();
  // Resolve wasm path relative to this file's package
  const wasmPath = resolve(import.meta.dir, "../../node_modules/tree-sitter-wasms/out/tree-sitter-rust.wasm");
  const lang = await Parser.Language.load(wasmPath);
  parser.setLanguage(lang);
  rustParser = parser;
}

/** Check if the Rust parser is initialized. */
export function isRustParserReady(): boolean {
  return rustParser !== null;
}

// ── Node type → symbol kind mapping ──

const NODE_KINDS: Record<string, string> = {
  function_item: "function",
  struct_item: "struct",
  enum_item: "enum",
  trait_item: "trait",
  impl_item: "impl",
  type_item: "type",
  const_item: "const",
  static_item: "static",
  mod_item: "mod",
  macro_definition: "macro",
};

// ── Core ──

export function parseRustSymbols(source: string, _filename: string): OxcSymbol[] {
  if (!rustParser) throw new Error("Rust parser not initialized. Call initRustParser() first.");
  if (!source.trim()) return [];

  const tree = rustParser.parse(source);
  const symbols: OxcSymbol[] = [];

  for (const node of tree.rootNode.namedChildren) {
    const kind = NODE_KINDS[node.type];
    if (!kind) continue;

    const name = extractName(node);
    if (!name) continue;

    const hasVis = node.namedChildren.some(
      (c) => c.type === "visibility_modifier",
    );

    symbols.push({
      name,
      kind,
      exported: hasVis,
      line: node.startPosition.row + 1, // 1-based
      range: { start: node.startIndex, end: node.endIndex },
    });
  }

  return symbols;
}

// ── Name extraction ──

function extractName(node: Parser.SyntaxNode): string | null {
  // impl blocks: "impl Type" or "impl Trait for Type"
  if (node.type === "impl_item") {
    return extractImplName(node);
  }

  // macro_definition: name is the first identifier child
  if (node.type === "macro_definition") {
    const nameNode = node.namedChildren.find((c) => c.type === "identifier");
    return nameNode?.text ?? null;
  }

  // Everything else: look for `name` field
  const nameNode = node.childForFieldName("name");
  return nameNode?.text ?? null;
}

function extractImplName(node: Parser.SyntaxNode): string {
  // impl Trait for Type { ... }
  // Children: [visibility_modifier?], type_identifier|generic_type, "for", type_identifier|generic_type, declaration_list
  // impl Type { ... }
  // Children: [visibility_modifier?], type_identifier|generic_type, declaration_list

  const typeNodes: string[] = [];
  let sawFor = false;

  for (const child of node.children) {
    if (child.type === "visibility_modifier") continue;
    if (child.type === "declaration_list") break;
    if (child.type === "type_parameters" || child.type === "where_clause") continue;

    if (child.text === "impl") continue;
    if (child.text === "for") {
      sawFor = true;
      continue;
    }

    // Collect type names (strip generics for readability)
    const typeName = child.type === "generic_type"
      ? child.namedChildren[0]?.text ?? child.text
      : child.text;
    typeNodes.push(typeName);
  }

  if (sawFor && typeNodes.length >= 2) {
    return `${typeNodes[0]} for ${typeNodes[1]}`;
  }
  return typeNodes[0] ?? "impl";
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test src/pure/RustSymbols.test.ts`
Expected: 6 tests PASS.

**Step 5: Commit**

```bash
git add src/pure/RustSymbols.ts src/pure/RustSymbols.test.ts
git commit -m "feat(kart): add Rust symbol extraction via tree-sitter"
```

---

## Task 3: Parameterize `Find.ts` for multi-language

**Files:**
- Modify: `packages/kart/src/Find.ts`
- Test: `packages/kart/src/Find.test.ts`

### Step 1: Write the failing test

Add to `Find.test.ts`:

```typescript
import { initRustParser } from "./pure/RustSymbols.js";

describe("findSymbols — Rust", () => {
  test("finds Rust symbols by name", async () => {
    await initRustParser();
    writeFixture("lib.rs", "pub fn greet() {}\nfn internal() {}\n");
    const result = await findSymbols({ name: "greet", rootDir: tempDir });
    expect(result.symbols).toHaveLength(1);
    expect(result.symbols[0].name).toBe("greet");
    expect(result.symbols[0].kind).toBe("function");
    expect(result.symbols[0].file).toBe("lib.rs");
  });

  test("finds both TS and Rust in mixed workspace", async () => {
    await initRustParser();
    writeFixture("app.ts", "export function hello() {}\n");
    writeFixture("lib.rs", "pub fn greet() {}\n");
    const result = await findSymbols({ name: "", rootDir: tempDir });
    const files = result.symbols.map((s) => s.file);
    expect(files).toContain("app.ts");
    expect(files).toContain("lib.rs");
  });

  test("filters Rust by kind", async () => {
    await initRustParser();
    writeFixture("lib.rs", "pub fn greet() {}\npub struct Config {}\n");
    const result = await findSymbols({ name: "", kind: "struct", rootDir: tempDir });
    expect(result.symbols).toHaveLength(1);
    expect(result.symbols[0].name).toBe("Config");
  });

  test("filters Rust by exported", async () => {
    await initRustParser();
    writeFixture("lib.rs", "pub fn greet() {}\nfn internal() {}\n");
    const result = await findSymbols({ name: "", exported: false, rootDir: tempDir });
    expect(result.symbols).toHaveLength(1);
    expect(result.symbols[0].name).toBe("internal");
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test src/Find.test.ts`
Expected: FAIL — `.rs` files not collected (not in `TS_EXTENSIONS`).

### Step 3: Implement changes to `Find.ts`

Changes:
1. Rename `TS_EXTENSIONS` → `SUPPORTED_EXTENSIONS`, add `".rs"`
2. Add import for `parseRustSymbols`, `initRustParser`, `isRustParserReady`
3. Add `parseFile(source, path)` router function
4. Call `initRustParser()` lazily on first `.rs` file encounter

```typescript
// At top of Find.ts, add import:
import { initRustParser, isRustParserReady, parseRustSymbols } from "./pure/RustSymbols.js";

// Replace TS_EXTENSIONS:
const SUPPORTED_EXTENSIONS = new Set([".ts", ".tsx", ".rs"]);

// Add router:
async function parseFile(source: string, path: string): Promise<OxcSymbol[]> {
  if (path.endsWith(".rs")) {
    if (!isRustParserReady()) await initRustParser();
    return parseRustSymbols(source, path);
  }
  return parseSymbols(source, path);
}

// In findSymbols, change:
//   const symbols = parseSymbols(source, f.path);
// to:
//   const symbols = await parseFile(source, f.path);
```

Also update `collectFiles` to use `SUPPORTED_EXTENSIONS` instead of `TS_EXTENSIONS`, and add `"target"` to `EXCLUDED_DIRS` (Rust build output).

**Step 4: Run tests to verify they pass**

Run: `bun test src/Find.test.ts`
Expected: All 17+ tests PASS (existing TS + new Rust).

**Step 5: Commit**

```bash
git add src/Find.ts src/Find.test.ts
git commit -m "feat(kart): add Rust support to kart_find"
```

---

## Task 4: Parameterize `ExportDetection.ts`

**Files:**
- Modify: `packages/kart/src/pure/ExportDetection.ts`
- Test: `packages/kart/src/pure/ExportDetection.test.ts` (if exists, else add to existing)

### Step 1: Write the failing test

Check if `ExportDetection.test.ts` exists. If not, add inline tests. The change is small: add a `language` parameter or auto-detect from filename.

```typescript
test("detects Rust pub exports", () => {
  const symbol = { range: { start: { line: 0, character: 0 } } } as DocumentSymbol;
  const lines = ["pub fn greet() {}"];
  expect(isExported(symbol, lines)).toBe(true);
});

test("detects Rust private functions", () => {
  const symbol = { range: { start: { line: 0, character: 0 } } } as DocumentSymbol;
  const lines = ["fn internal() {}"];
  expect(isExported(symbol, lines)).toBe(false);
});
```

### Step 2: Implement

The existing `isExported` checks `line.startsWith("export ")`. For Rust, `pub ` works the same way — both `export ` and `pub ` are line-start keywords. The simplest fix:

```typescript
export function isExported(symbol: DocumentSymbol, lines: readonly string[]): boolean {
  const lineIndex = symbol.range.start.line;
  if (lineIndex < 0 || lineIndex >= lines.length) return false;
  const line = lines[lineIndex].trimStart();
  return line.startsWith("export ") || line.startsWith("pub ");
}
```

This is safe — `pub ` never appears at the start of a TS line, and `export ` never appears at the start of a Rust line.

### Step 3: Commit

```bash
git add src/pure/ExportDetection.ts
git commit -m "feat(kart): add Rust pub export detection"
```

---

## Task 5: Parameterize `Lsp.ts` for rust-analyzer

**Files:**
- Modify: `packages/kart/src/Lsp.ts`
- Test: `packages/kart/src/Lsp.test.ts`

### Step 1: Extract `LspConfig` type

Add near top of `Lsp.ts`:

```typescript
export type LspConfig = {
  /** Binary name to find/spawn */
  readonly binary: string;
  /** CLI args (e.g. ["--stdio"]) */
  readonly args: string[];
  /** Map file path → LSP languageId */
  readonly languageId: (path: string) => string;
  /** File extensions to watch for changes */
  readonly watchExtensions: ReadonlySet<string>;
  /** Specific filenames to watch */
  readonly watchFilenames: ReadonlySet<string>;
};

export const tsLspConfig: LspConfig = {
  binary: "typescript-language-server",
  args: ["--stdio"],
  languageId: (path) => path.endsWith(".tsx") ? "typescriptreact" : "typescript",
  watchExtensions: new Set([".ts", ".tsx"]),
  watchFilenames: new Set(["tsconfig.json", "package.json"]),
};

export const rustLspConfig: LspConfig = {
  binary: "rust-analyzer",
  args: [],
  languageId: () => "rust",
  watchExtensions: new Set([".rs"]),
  watchFilenames: new Set(["Cargo.toml", "Cargo.lock"]),
};
```

### Step 2: Parameterize `LspClientLive`

Change signature from `LspClientLive({ rootDir })` to `LspClientLive({ rootDir, lspConfig })` where `lspConfig` defaults to `tsLspConfig`.

Replace all hardcoded references:
- `findLspBinary("typescript-language-server")` → `findLspBinary(config.binary)`
- `Bun.spawn([binary, "--stdio"])` → `Bun.spawn([binary, ...config.args])`
- `languageId: path.endsWith(".tsx") ? "typescriptreact" : "typescript"` → `config.languageId(path)`
- `WATCHED_EXTENSIONS` / `WATCHED_FILENAMES` → `config.watchExtensions` / `config.watchFilenames`

### Step 3: Verify existing TS tests still pass

Run: `bun test src/Lsp.test.ts`
Expected: All 8 tests PASS (no behavior change, just parameterized).

### Step 4: Add rust-analyzer test (guarded)

```typescript
const hasRustAnalyzer = !!Bun.which("rust-analyzer");

describe.skipIf(!hasRustAnalyzer || !!process.env.TURBO_HASH)("LspClient — rust-analyzer", () => {
  // Create a temp Rust project, spawn rust-analyzer, test documentSymbol
  // ... (similar pattern to existing TS LSP tests)
});
```

This test is gated on `rust-analyzer` being available. It validates the config works but won't block CI without `rust-analyzer`.

### Step 5: Commit

```bash
git add src/Lsp.ts src/Lsp.test.ts
git commit -m "feat(kart): parameterize LSP client for multi-language support"
```

---

## Task 6: Parameterize `Symbols.ts` for multi-language zoom

**Files:**
- Modify: `packages/kart/src/Symbols.ts`

### Step 1: Identify changes

`zoomDirectory` (line ~564) filters `.ts`/`.tsx` and skips `.test.ts`/`.test.tsx`. Add `.rs` and skip `_test.rs` / `tests/` patterns.

### Step 2: Implement

```typescript
// Replace hardcoded extension filters with:
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".rs"]);
const TEST_PATTERNS = [".test.ts", ".test.tsx", "_test.rs", ".spec.ts"];

// In zoomDirectory:
.filter((e) => SOURCE_EXTENSIONS.has(extname(e)))
.filter((e) => !TEST_PATTERNS.some((p) => e.endsWith(p)))
```

### Step 3: Verify existing zoom tests pass

Run: `bun test src/Symbols.test.ts`
Expected: All 22 tests PASS.

### Step 4: Commit

```bash
git add src/Symbols.ts
git commit -m "feat(kart): add Rust extensions to zoom directory listing"
```

---

## Task 7: Wire up in `Mcp.ts`

**Files:**
- Modify: `packages/kart/src/Mcp.ts`
- Test: `packages/kart/src/Mcp.test.ts`

### Step 1: Add rust-analyzer runtime

In `createServer`, add a second `ManagedRuntime` for rust-analyzer (only created if `rust-analyzer` is found):

```typescript
import { rustLspConfig, tsLspConfig } from "./Lsp.js";
import { initRustParser } from "./pure/RustSymbols.js";

// Existing TS runtime (unchanged):
const makeZoomRuntime = () =>
  ManagedRuntime.make(
    SymbolIndexLive({ rootDir }).pipe(Layer.provide(LspClientLive({ rootDir, lspConfig: tsLspConfig }))),
  );

// New Rust runtime (lazy — only created on first .rs tool call):
let rustRuntime: ManagedRuntime.ManagedRuntime<SymbolIndex, never> | null = null;
const makeRustRuntime = () =>
  ManagedRuntime.make(
    SymbolIndexLive({ rootDir }).pipe(Layer.provide(LspClientLive({ rootDir, lspConfig: rustLspConfig }))),
  );
```

### Step 2: Route kart_zoom by extension

```typescript
// In kart_zoom handler:
const runtime = (args.path as string).endsWith(".rs")
  ? (rustRuntime ??= makeRustRuntime())
  : zoomRuntime;
const result = await runtime.runPromise(kart_zoom.handler(args));
```

Same routing for `kart_impact`, `kart_deps`, `kart_references`, `kart_rename`.

### Step 3: Update kart_restart

```typescript
// In kart_restart handler, also dispose rustRuntime:
if (rustRuntime) {
  try { await rustRuntime.dispose(); } catch { /* ignore */ }
  rustRuntime = null;
}
```

### Step 4: Initialize Rust parser on server start

```typescript
// In createServer, after server creation:
initRustParser().catch(() => {
  // tree-sitter init failed — .rs files won't work in kart_find
  // but TS tools still function
});
```

### Step 5: Update tests

In `Mcp.test.ts`, verify that kart_find works with `.rs` fixtures (no rust-analyzer needed — find uses tree-sitter directly).

### Step 6: Commit

```bash
git add src/Mcp.ts src/Mcp.test.ts
git commit -m "feat(kart): wire up Rust support in MCP server"
```

---

## Task 8: Verification

**Step 1: Run all pure tests**

Run: `bun test src/pure/`
Expected: All pass including new RustSymbols tests.

**Step 2: Run all integration tests**

Run: `bun test src/*.test.ts`
Expected: All pass. Rust LSP tests skipped if no `rust-analyzer`.

**Step 3: Full check**

Run: `turbo check`
Expected: 0 warnings, 0 errors across all packages. Build succeeds.

**Step 4: Manual verification**

If `rust-analyzer` is available:
```bash
# Test kart_find on a Rust project
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"kart_find","arguments":{"name":"main"}}}' | bun packages/kart/dist/Mcp.js
```

**Step 5: Update docs**

- `README.md`: Add Rust support section, update tool descriptions
- `docs/architecture.md`: Add Rust column to the overview
- `docs/design.md`: Add section on multi-language routing

**Step 6: Commit and push**

```bash
git add -A
git commit -m "docs(kart): document Rust support"
git push
```
