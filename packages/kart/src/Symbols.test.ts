import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { Effect, Either, Layer, ManagedRuntime } from "effect";

import { FileNotFoundError } from "./Errors.js";
import { LspClientLive } from "./Lsp.js";
import { extractDocComment, extractSignature, SymbolIndex, SymbolIndexLive } from "./Symbols.js";
import type { DocumentSymbol } from "./Lsp.js";

// ── Fixtures ──

const FIXTURE_DIR = resolve(import.meta.dir, "__fixtures__");

// ── Pure function tests (no LSP needed) ──

describe("extractSignature", () => {
  const makeSymbol = (
    name: string,
    kind: number,
    startLine: number,
    startChar: number,
    endLine: number,
    endChar: number,
  ): DocumentSymbol => ({
    name,
    kind,
    range: { start: { line: startLine, character: startChar }, end: { line: endLine, character: endChar } },
    selectionRange: { start: { line: startLine, character: startChar }, end: { line: endLine, character: endChar } },
  });

  test("extracts function signature up to opening brace", () => {
    const lines = ["export function greet(name: string): string {", '  return `Hello ${name}`;', "}"];
    const sym = makeSymbol("greet", 12, 0, 0, 2, 1);
    const sig = extractSignature(sym, lines);
    expect(sig).toBe("export function greet(name: string): string");
  });

  test("extracts const declaration", () => {
    const lines = ["export const MAX_COUNT = 100;"];
    const sym = makeSymbol("MAX_COUNT", 13, 0, 0, 0, 28);
    const sig = extractSignature(sym, lines);
    expect(sig).toBe("export const MAX_COUNT = 100;");
  });

  test("extracts type alias", () => {
    const lines = ["export type ID = string | number;"];
    const sym = makeSymbol("ID", 26, 0, 0, 0, 32);
    const sig = extractSignature(sym, lines);
    expect(sig).toBe("export type ID = string | number;");
  });

  test("extracts class name up to opening brace", () => {
    const lines = ["export class UserService {", "  constructor(public name: string) {}", "}"];
    const sym = makeSymbol("UserService", 5, 0, 0, 2, 1);
    const sig = extractSignature(sym, lines);
    expect(sig).toBe("export class UserService");
  });

  test("extracts interface name up to opening brace", () => {
    const lines = ["export interface Config {", "  debug: boolean;", "}"];
    const sym = makeSymbol("Config", 11, 0, 0, 2, 1);
    const sig = extractSignature(sym, lines);
    expect(sig).toBe("export interface Config");
  });

  test("handles multiline function signature", () => {
    const lines = [
      "export function createUser(",
      "  name: string,",
      "  age: number,",
      "): User {",
      "  return { name, age };",
      "}",
    ];
    const sym = makeSymbol("createUser", 12, 0, 0, 5, 1);
    const sig = extractSignature(sym, lines);
    expect(sig).toBe("export function createUser(\n  name: string,\n  age: number,\n): User");
  });

  test("returns name for out-of-range line", () => {
    const sym = makeSymbol("ghost", 12, 9999, 0, 9999, 10);
    const sig = extractSignature(sym, ["const x = 1;"]);
    expect(sig).toBe("ghost");
  });
});

describe("extractDocComment", () => {
  const makeSymbol = (startLine: number): DocumentSymbol => ({
    name: "test",
    kind: 12,
    range: { start: { line: startLine, character: 0 }, end: { line: startLine, character: 20 } },
    selectionRange: { start: { line: startLine, character: 0 }, end: { line: startLine, character: 20 } },
  });

  test("extracts single-line JSDoc comment", () => {
    const lines = ["/** Greet a user by name. */", "export function greet(name: string): string {"];
    const result = extractDocComment(makeSymbol(1), lines);
    expect(result).toBe("/** Greet a user by name. */");
  });

  test("extracts multi-line JSDoc comment", () => {
    const lines = [
      "/**",
      " * Create a new user.",
      " * @param name - The user's name",
      " */",
      "export function createUser(name: string) {",
    ];
    const result = extractDocComment(makeSymbol(4), lines);
    expect(result).toBe("/**\n * Create a new user.\n * @param name - The user's name\n */");
  });

  test("returns null when no doc comment present", () => {
    const lines = ["const x = 1;", "export function greet() {"];
    const result = extractDocComment(makeSymbol(1), lines);
    expect(result).toBeNull();
  });

  test("returns null for regular comments (not JSDoc)", () => {
    const lines = ["// This is a regular comment", "export function greet() {"];
    const result = extractDocComment(makeSymbol(1), lines);
    expect(result).toBeNull();
  });

  test("skips blank lines between doc comment and symbol", () => {
    const lines = ["/** Documented. */", "", "export function greet() {"];
    const result = extractDocComment(makeSymbol(2), lines);
    expect(result).toBe("/** Documented. */");
  });
});

// ── LSP integration tests ──

const hasLsp = Bun.which("typescript-language-server") !== null;

describe.skipIf(!hasLsp)("SymbolIndex (LSP integration)", () => {
  let tempDir: string;
  let runtime: ManagedRuntime.ManagedRuntime<SymbolIndex, never>;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "kart-symbols-"));

    // Copy fixture files
    await writeFile(join(tempDir, "exports.ts"), readFileSync(join(FIXTURE_DIR, "exports.ts")));
    await writeFile(join(tempDir, "other.ts"), readFileSync(join(FIXTURE_DIR, "other.ts")));
    await writeFile(
      join(tempDir, "tsconfig.json"),
      readFileSync(join(FIXTURE_DIR, "tsconfig.json")),
    );

    // Create a file with no exports for directory zoom test
    await writeFile(join(tempDir, "internal.ts"), "function privateHelper() {}\nconst HIDDEN = 42;\n");

    // Symlink typescript into temp dir
    const repoRoot = resolve(import.meta.dir, "../../..");
    const typescriptSrc = join(repoRoot, "node_modules", "typescript");
    await mkdir(join(tempDir, "node_modules"), { recursive: true });
    await symlink(typescriptSrc, join(tempDir, "node_modules", "typescript"));

    const layer = SymbolIndexLive.pipe(Layer.provide(LspClientLive({ rootDir: tempDir })));
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
