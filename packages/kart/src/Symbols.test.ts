import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

mkdirSync("/tmp/claude", { recursive: true });

import { Effect, Either, Layer, ManagedRuntime } from "effect";

import { LspClientLive } from "./Lsp.js";
import { FileNotFoundError } from "./pure/Errors.js";
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

  test("level 0: returns only exported symbols", async () => {
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const idx = yield* SymbolIndex;
        return yield* idx.zoom(join(tempDir, "exports.ts"), 0);
      }),
    );

    expect(result.level).toBe(0);
    expect(result.truncated).toBe(true);

    const names = result.symbols.map((s) => s.name);
    // Should contain exported symbols
    expect(names).toContain("greet");
    expect(names).toContain("MAX_COUNT");
    expect(names).toContain("UserService");
    expect(names).toContain("Config");
    expect(names).toContain("ID");
    expect(names).toContain("defaultFn");

    // Should NOT contain non-exported symbols
    expect(names).not.toContain("helper");
    expect(names).not.toContain("INTERNAL");
    expect(names).not.toContain("InternalService");
    expect(names).not.toContain("InternalConfig");
    expect(names).not.toContain("InternalId");

    // All returned symbols should be marked exported
    for (const sym of result.symbols) {
      expect(sym.exported).toBe(true);
    }
  }, 30_000);

  test("level 1: returns all symbols including non-exported", async () => {
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const idx = yield* SymbolIndex;
        return yield* idx.zoom(join(tempDir, "exports.ts"), 1);
      }),
    );

    expect(result.level).toBe(1);
    expect(result.truncated).toBe(true);

    const names = result.symbols.map((s) => s.name);
    // Should contain both exported and non-exported
    expect(names).toContain("greet");
    expect(names).toContain("helper");
    expect(names).toContain("INTERNAL");
    expect(names).toContain("InternalService");
  }, 30_000);

  test("level 2: returns full file content", async () => {
    const filePath = join(tempDir, "exports.ts");
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const idx = yield* SymbolIndex;
        return yield* idx.zoom(filePath, 2);
      }),
    );

    expect(result.level).toBe(2);
    expect(result.truncated).toBe(false);
    expect(result.symbols).toHaveLength(1);
    expect(result.symbols[0].kind).toBe("file");

    // The signature should contain the full file content
    const expectedContent = readFileSync(filePath, "utf-8");
    expect(result.symbols[0].signature).toBe(expectedContent);
  }, 30_000);

  test("directory zoom: returns level-0 for each .ts file, omits files with no exports", async () => {
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const idx = yield* SymbolIndex;
        return yield* idx.zoom(tempDir, 0);
      }),
    );

    expect(result.symbols).toHaveLength(0);
    expect(result.files).toBeDefined();
    expect(result.files!.length).toBeGreaterThan(0);

    // Each file result should have only exported symbols
    for (const fileResult of result.files!) {
      for (const sym of fileResult.symbols) {
        expect(sym.exported).toBe(true);
      }
    }

    // internal.ts should be omitted (no exports)
    const filePaths = result.files!.map((f) => f.path);
    expect(filePaths.some((p) => p.endsWith("internal.ts"))).toBe(false);

    // exports.ts and other.ts should be present
    expect(filePaths.some((p) => p.endsWith("exports.ts"))).toBe(true);
    expect(filePaths.some((p) => p.endsWith("other.ts"))).toBe(true);
  }, 30_000);

  test("file not found: fails with FileNotFoundError", async () => {
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const idx = yield* SymbolIndex;
        return yield* Effect.either(idx.zoom(join(tempDir, "nonexistent.ts"), 0));
      }),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(FileNotFoundError);
    }
  }, 30_000);

  test("signature extraction: function signatures include parameter types and return type", async () => {
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const idx = yield* SymbolIndex;
        return yield* idx.zoom(join(tempDir, "exports.ts"), 0);
      }),
    );

    const greet = result.symbols.find((s) => s.name === "greet");
    expect(greet).toBeDefined();
    expect(greet!.signature).toContain("name: string");
    expect(greet!.signature).toContain(": string");
    expect(greet!.kind).toBe("function");
  }, 30_000);

  test("doc comments: JSDoc comment is extracted", async () => {
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const idx = yield* SymbolIndex;
        return yield* idx.zoom(join(tempDir, "exports.ts"), 0);
      }),
    );

    const greet = result.symbols.find((s) => s.name === "greet");
    expect(greet).toBeDefined();
    expect(greet!.doc).toBe("/** Greet a user by name. */");
  }, 30_000);

  test("human-readable kind names", async () => {
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const idx = yield* SymbolIndex;
        return yield* idx.zoom(join(tempDir, "exports.ts"), 1);
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
