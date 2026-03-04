import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

mkdirSync("/tmp/claude", { recursive: true });

import { Effect, Either, Layer, ManagedRuntime } from "effect";

import { FileNotFoundError } from "./core/Errors.js";
import { LspClientLive } from "./Lsp.js";
import { SymbolIndex, SymbolIndexLive } from "./Symbols.js";

// ── Fixtures ──

const FIXTURE_DIR = resolve(import.meta.dir, "__fixtures__");

// ── LSP integration tests ──

const hasLsp = Bun.which("typescript-language-server") !== null && !process.env.TURBO_HASH;

describe.skipIf(!hasLsp)("SymbolIndex (LSP integration)", () => {
  let tempDir: string;
  let runtime: ManagedRuntime.ManagedRuntime<SymbolIndex, never>;

  beforeAll(async () => {
    tempDir = await mkdtemp(join("/tmp/claude/", "kart-symbols-"));

    // Copy fixture files
    await writeFile(join(tempDir, "exports.ts"), readFileSync(join(FIXTURE_DIR, "exports.ts")));
    await writeFile(join(tempDir, "other.ts"), readFileSync(join(FIXTURE_DIR, "other.ts")));
    await writeFile(
      join(tempDir, "tsconfig.json"),
      readFileSync(join(FIXTURE_DIR, "tsconfig.json")),
    );

    // Create a file with no exports for directory zoom test
    await writeFile(
      join(tempDir, "internal.ts"),
      "function privateHelper() {}\nconst HIDDEN = 42;\n",
    );

    // Symlink typescript into temp dir
    const repoRoot = resolve(import.meta.dir, "../../..");
    const typescriptSrc = join(repoRoot, "node_modules", "typescript");
    await mkdir(join(tempDir, "node_modules"), { recursive: true });
    await symlink(typescriptSrc, join(tempDir, "node_modules", "typescript"));

    const layer = SymbolIndexLive({ rootDir: tempDir }).pipe(
      Layer.provide(LspClientLive({ rootDir: tempDir })),
    );
    runtime = ManagedRuntime.make(layer);
    await runtime.runPromise(Effect.void);
  }, 30_000);

  afterAll(async () => {
    if (runtime) await runtime.dispose();
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  }, 15_000);

  // ── depth=0, visibility="exported" (default): .d.ts via DeclCache ──

  test("depth=0, exported: returns .d.ts content as single declarations symbol", async () => {
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const idx = yield* SymbolIndex;
        return yield* idx.zoom(join(tempDir, "exports.ts"), {
          depth: 0,
          visibility: "exported",
          deep: false,
        });
      }),
    );

    expect(result.depth).toBe(0);
    expect(result.symbols).toHaveLength(1);
    expect(result.symbols[0].kind).toBe("declarations");
    expect(result.symbols[0].exported).toBe(true);

    // .d.ts content should contain exported declarations
    const dts = result.symbols[0].signature;
    expect(dts).toContain("greet");
    expect(dts).toContain("MAX_COUNT");
    expect(dts).toContain("UserService");
    expect(dts).toContain("Config");
    expect(dts).toContain("ID");

    // Should NOT contain non-exported symbols
    expect(dts).not.toContain("helper");
    expect(dts).not.toContain("INTERNAL");
    expect(dts).not.toContain("InternalService");
  }, 30_000);

  // ── depth=0, visibility="all": LSP fallback with all symbols ──

  test("depth=0, visibility='all': returns all symbols via LSP fallback", async () => {
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const idx = yield* SymbolIndex;
        return yield* idx.zoom(join(tempDir, "exports.ts"), {
          depth: 0,
          visibility: "all",
          deep: false,
        });
      }),
    );

    expect(result.depth).toBe(0);
    // LSP path returns multiple ZoomSymbol entries (not a single declarations blob)
    expect(result.symbols.length).toBeGreaterThan(1);

    const names = result.symbols.map((s) => s.name);
    // Should contain both exported and non-exported
    expect(names).toContain("greet");
    expect(names).toContain("helper");
    expect(names).toContain("INTERNAL");
    expect(names).toContain("InternalService");
  }, 30_000);

  // ── depth=1, exported: BFS type-graph pulls in referenced files ──

  test("depth=1, exported: referencedFiles contains imported type declarations", async () => {
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const idx = yield* SymbolIndex;
        return yield* idx.zoom(join(tempDir, "exports.ts"), {
          depth: 1,
          visibility: "exported",
          deep: false,
        });
      }),
    );

    expect(result.depth).toBe(1);
    expect(result.symbols).toHaveLength(1);
    expect(result.symbols[0].kind).toBe("declarations");

    // exports.ts re-exports from ./other.js, so depth=1 should pull in other.ts
    expect(result.referencedFiles).toBeDefined();
    expect(result.referencedFiles!.length).toBeGreaterThanOrEqual(1);

    const refPaths = result.referencedFiles!.map((f) => f.path);
    expect(refPaths.some((p) => p.endsWith("other.ts"))).toBe(true);

    // Referenced file content should be .d.ts declarations
    const otherRef = result.referencedFiles!.find((f) => f.path.endsWith("other.ts"));
    expect(otherRef).toBeDefined();
    expect(otherRef!.content).toContain("something");
  }, 30_000);

  // ── visibility="all" includes non-exported symbols ──

  test("visibility='all' includes non-exported symbols", async () => {
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const idx = yield* SymbolIndex;
        return yield* idx.zoom(join(tempDir, "exports.ts"), {
          depth: 0,
          visibility: "all",
          deep: false,
        });
      }),
    );

    const names = result.symbols.map((s) => s.name);
    // Non-exported symbols should be present
    expect(names).toContain("helper");
    expect(names).toContain("INTERNAL");
    // Exported symbols should also be present
    expect(names).toContain("greet");
    expect(names).toContain("MAX_COUNT");
  }, 30_000);

  // ── kind filter ──

  test("kind filter: depth=0 with kind=['function'] only returns functions", async () => {
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const idx = yield* SymbolIndex;
        return yield* idx.zoom(join(tempDir, "exports.ts"), {
          depth: 0,
          visibility: "exported",
          kind: ["function"],
          deep: false,
        });
      }),
    );

    expect(result.depth).toBe(0);
    expect(result.symbols).toHaveLength(1);
    expect(result.symbols[0].kind).toBe("declarations");

    // .d.ts content should only contain function declarations
    const dts = result.symbols[0].signature;
    expect(dts).toContain("function");
    // Should not contain class, interface, type, or const declarations
    expect(dts).not.toContain("class UserService");
    expect(dts).not.toContain("interface Config");
  }, 30_000);

  // ── directory zoom depth=0 ──

  test("directory zoom depth=0: returns file list with export counts", async () => {
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const idx = yield* SymbolIndex;
        return yield* idx.zoom(tempDir, {
          depth: 0,
          visibility: "exported",
          deep: false,
        });
      }),
    );

    expect(result.symbols).toHaveLength(0);
    expect(result.files).toBeDefined();
    expect(result.files!.length).toBeGreaterThan(0);

    // Compact mode: each file has one "file" symbol with export count
    for (const fileResult of result.files!) {
      expect(fileResult.symbols).toHaveLength(1);
      expect(fileResult.symbols[0].kind).toBe("file");
      expect(fileResult.symbols[0].signature).toMatch(/\d+ exports/);
    }

    // internal.ts should be omitted (no exports)
    const filePaths = result.files!.map((f) => f.path);
    expect(filePaths.some((p) => p.endsWith("internal.ts"))).toBe(false);

    // exports.ts and other.ts should be present
    expect(filePaths.some((p) => p.endsWith("exports.ts"))).toBe(true);
    expect(filePaths.some((p) => p.endsWith("other.ts"))).toBe(true);
  }, 30_000);

  // ── directory zoom depth=1 ──

  test("directory zoom depth=1: returns per-file declarations", async () => {
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const idx = yield* SymbolIndex;
        return yield* idx.zoom(tempDir, {
          depth: 1,
          visibility: "exported",
          deep: false,
        });
      }),
    );

    expect(result.depth).toBe(1);
    expect(result.files).toBeDefined();
    expect(result.files!.length).toBeGreaterThan(0);

    // Depth 1+: each file should have declarations content
    const exportsFile = result.files!.find((f) => f.path.endsWith("exports.ts"));
    expect(exportsFile).toBeDefined();
    expect(exportsFile!.symbols).toHaveLength(1);
    expect(exportsFile!.symbols[0].kind).toBe("declarations");
    expect(exportsFile!.symbols[0].signature).toContain("greet");
  }, 30_000);

  // ── file not found ──

  test("file not found: fails with FileNotFoundError", async () => {
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const idx = yield* SymbolIndex;
        return yield* Effect.either(
          idx.zoom(join(tempDir, "nonexistent.ts"), {
            depth: 0,
            visibility: "exported",
            deep: false,
          }),
        );
      }),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(FileNotFoundError);
    }
  }, 30_000);

  // ── impact tests ──

  test("impact: path traversal outside workspace root fails", async () => {
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const idx = yield* SymbolIndex;
        return yield* Effect.either(idx.impact("/etc/passwd", "greet"));
      }),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(FileNotFoundError);
      expect((result.left as FileNotFoundError).path).toContain("Access denied");
    }
  }, 30_000);

  test("impact: nonexistent file fails with FileNotFoundError", async () => {
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const idx = yield* SymbolIndex;
        return yield* Effect.either(idx.impact(join(tempDir, "nonexistent.ts"), "greet"));
      }),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(FileNotFoundError);
    }
  }, 30_000);

  test("impact: unknown symbol fails with FileNotFoundError", async () => {
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const idx = yield* SymbolIndex;
        return yield* Effect.either(idx.impact(join(tempDir, "exports.ts"), "doesNotExist"));
      }),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(FileNotFoundError);
      expect((result.left as FileNotFoundError).path).toContain("doesNotExist");
    }
  }, 30_000);

  test("impact: constant with no call hierarchy returns FileNotFoundError", async () => {
    // MAX_COUNT is a const — call hierarchy may not be available for it
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const idx = yield* SymbolIndex;
        return yield* Effect.either(idx.impact(join(tempDir, "exports.ts"), "INTERNAL"));
      }),
    );

    // INTERNAL is not exported and is a const — prepareCallHierarchy may return empty
    // Either it succeeds with 0 callers or fails with FileNotFoundError
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(FileNotFoundError);
    } else {
      expect(result.right.totalNodes).toBeGreaterThanOrEqual(1);
    }
  }, 30_000);

  test("impact: returns valid tree for exported function", async () => {
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const idx = yield* SymbolIndex;
        return yield* idx.impact(join(tempDir, "exports.ts"), "greet");
      }),
    );

    expect(result.symbol).toBe("greet");
    expect(result.depth).toBe(3); // default
    expect(result.maxDepth).toBe(5);
    expect(result.totalNodes).toBeGreaterThanOrEqual(1);
    expect(result.root.name).toBe("greet");
  }, 30_000);

  // ── deps tests ──

  test("deps: path traversal outside workspace root fails", async () => {
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const idx = yield* SymbolIndex;
        return yield* Effect.either(idx.deps("/etc/passwd", "greet"));
      }),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(FileNotFoundError);
      expect((result.left as FileNotFoundError).path).toContain("Access denied");
    }
  }, 30_000);

  test("deps: unknown symbol fails with FileNotFoundError", async () => {
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const idx = yield* SymbolIndex;
        return yield* Effect.either(idx.deps(join(tempDir, "exports.ts"), "doesNotExist"));
      }),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(FileNotFoundError);
      expect((result.left as FileNotFoundError).path).toContain("doesNotExist");
    }
  }, 30_000);

  test("deps: returns valid tree for function with dependencies", async () => {
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const idx = yield* SymbolIndex;
        return yield* idx.deps(join(tempDir, "exports.ts"), "greet");
      }),
    );

    expect(result.symbol).toBe("greet");
    expect(result.depth).toBe(3); // default
    expect(result.maxDepth).toBe(5);
    expect(result.totalNodes).toBeGreaterThanOrEqual(1);
    expect(result.root.name).toBe("greet");
  }, 30_000);

  // ── References tests ──

  test("references: finds references for exported symbol", async () => {
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const idx = yield* SymbolIndex;
        return yield* idx.references(join(tempDir, "exports.ts"), "greet");
      }),
    );

    expect(result.symbol).toBe("greet");
    expect(result.totalReferences).toBeGreaterThanOrEqual(1);
    expect(result.includesDeclaration).toBe(true);
    expect(result.references.length).toBe(result.totalReferences);
    // Each reference should have a path
    for (const ref of result.references) {
      expect(ref.path).toBeTruthy();
      expect(typeof ref.line).toBe("number");
      expect(typeof ref.character).toBe("number");
    }
  }, 30_000);

  test("references: unknown symbol fails with FileNotFoundError", async () => {
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const idx = yield* SymbolIndex;
        return yield* Effect.either(idx.references(join(tempDir, "exports.ts"), "nonexistent"));
      }),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(FileNotFoundError);
    }
  }, 30_000);

  test("references: path traversal outside workspace root fails", async () => {
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const idx = yield* SymbolIndex;
        return yield* Effect.either(idx.references("/etc/passwd", "greet"));
      }),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(FileNotFoundError);
    }
  }, 30_000);

  // ── Rename tests ──

  test("rename: renames symbol in file", async () => {
    // Create a disposable file in tempDir for rename (uses the existing runtime/LSP)
    const renamePath = join(tempDir, "rename-target.ts");
    await writeFile(
      renamePath,
      "export function greetUser(name: string): string {\n  return `Hello ${name}`;\n}\n",
    );

    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const idx = yield* SymbolIndex;
        return yield* idx.rename(renamePath, "greetUser", "sayHello");
      }),
    );

    expect(result.symbol).toBe("greetUser");
    expect(result.newName).toBe("sayHello");
    expect(result.filesModified.length).toBeGreaterThanOrEqual(1);
    expect(result.totalEdits).toBeGreaterThanOrEqual(1);

    // Verify the file was actually modified
    const { readFileSync } = await import("node:fs");
    const content = readFileSync(renamePath, "utf-8");
    expect(content).toContain("sayHello");
    expect(content).not.toContain("greetUser");
  }, 30_000);

  test("rename: unknown symbol fails with FileNotFoundError", async () => {
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const idx = yield* SymbolIndex;
        return yield* Effect.either(
          idx.rename(join(tempDir, "exports.ts"), "nonexistent", "newName"),
        );
      }),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(FileNotFoundError);
    }
  }, 30_000);

  test("human-readable kind names via visibility='all' (LSP fallback)", async () => {
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const idx = yield* SymbolIndex;
        return yield* idx.zoom(join(tempDir, "exports.ts"), {
          depth: 0,
          visibility: "all",
          deep: false,
        });
      }),
    );

    const kindMap = new Map(result.symbols.map((s) => [s.name, s.kind]));
    // These assertions depend on what typescript-language-server returns,
    // but should be stable for these basic declaration forms
    expect(kindMap.get("greet")).toBe("function");
    expect(kindMap.get("UserService")).toBe("class");
    expect(kindMap.get("Config")).toBe("interface");
  }, 30_000);
});
