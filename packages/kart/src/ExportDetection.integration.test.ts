import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { Effect, ManagedRuntime } from "effect";

import { LspClient, LspClientLive } from "./Lsp.js";
import { isExported } from "./pure/ExportDetection.js";
import type { SemanticToken } from "./pure/types.js";

// ── Fixtures ──

const FIXTURE_DIR = resolve(import.meta.dir, "__fixtures__");

// ── LSP integration: empirical validation of semantic tokens ──

const hasLsp = Bun.which("typescript-language-server") !== null;

describe.skipIf(!hasLsp)("Export detection spike (LSP integration)", () => {
  let tempDir: string;
  let fixtureUri: string;
  let runtime: ManagedRuntime.ManagedRuntime<LspClient, never>;

  beforeAll(async () => {
    // Copy fixtures to a temp dir with typescript available
    tempDir = await mkdtemp(join(tmpdir(), "kart-export-spike-"));

    // Copy fixture files
    await writeFile(join(tempDir, "exports.ts"), readFileSync(join(FIXTURE_DIR, "exports.ts")));
    await writeFile(join(tempDir, "other.ts"), readFileSync(join(FIXTURE_DIR, "other.ts")));
    await writeFile(
      join(tempDir, "tsconfig.json"),
      readFileSync(join(FIXTURE_DIR, "tsconfig.json")),
    );

    fixtureUri = `file://${join(tempDir, "exports.ts")}`;

    // Symlink typescript into temp dir
    const repoRoot = resolve(import.meta.dir, "../../..");
    const typescriptSrc = join(repoRoot, "node_modules", "typescript");
    await mkdir(join(tempDir, "node_modules"), { recursive: true });
    await symlink(typescriptSrc, join(tempDir, "node_modules", "typescript"));

    runtime = ManagedRuntime.make(LspClientLive({ rootDir: tempDir }));
    await runtime.runPromise(Effect.void);
  }, 30_000);

  afterAll(async () => {
    if (runtime) await runtime.dispose();
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  }, 15_000);

  test("documentSymbol returns both exported and non-exported symbols", async () => {
    const symbols = await runtime.runPromise(
      Effect.gen(function* () {
        const lsp = yield* LspClient;
        return yield* lsp.documentSymbol(fixtureUri);
      }),
    );

    const names = symbols.map((s) => s.name);
    // Exported
    expect(names).toContain("greet");
    expect(names).toContain("MAX_COUNT");
    expect(names).toContain("UserService");
    expect(names).toContain("Config");
    expect(names).toContain("ID");
    expect(names).toContain("defaultFn");
    // Not exported
    expect(names).toContain("helper");
    expect(names).toContain("INTERNAL");
    expect(names).toContain("InternalService");
    expect(names).toContain("InternalConfig");
    expect(names).toContain("InternalId");
  }, 30_000);

  test("isExported matches all symbols from documentSymbol", async () => {
    const symbols = await runtime.runPromise(
      Effect.gen(function* () {
        const lsp = yield* LspClient;
        return yield* lsp.documentSymbol(fixtureUri);
      }),
    );

    const content = readFileSync(join(tempDir, "exports.ts"), "utf-8");
    const contentLines = content.split("\n");
    const exported = new Set(["greet", "MAX_COUNT", "UserService", "Config", "ID", "defaultFn"]);
    const notExported = new Set([
      "helper",
      "INTERNAL",
      "InternalService",
      "InternalConfig",
      "InternalId",
    ]);

    for (const sym of symbols) {
      if (exported.has(sym.name)) {
        expect(isExported(sym, contentLines)).toBe(true);
      } else if (notExported.has(sym.name)) {
        expect(isExported(sym, contentLines)).toBe(false);
      }
    }
  }, 30_000);

  test("semantic tokens do NOT distinguish exported vs non-exported (spike validation)", async () => {
    const [symbols, tokenResult] = await runtime.runPromise(
      Effect.gen(function* () {
        const lsp = yield* LspClient;
        const syms = yield* lsp.documentSymbol(fixtureUri);
        const toks = yield* lsp.semanticTokens(fixtureUri);
        return [syms, toks] as const;
      }),
    );

    // SEMANTIC_TOKEN_MODIFIERS from Lsp.ts — the standard LSP set
    const MODIFIERS = [
      "declaration",
      "definition",
      "readonly",
      "static",
      "deprecated",
      "abstract",
      "async",
      "modification",
      "documentation",
      "defaultLibrary",
    ] as const;

    // Decode modifier bitmask to names
    const decodeModifiers = (bitmask: number): string[] => {
      const result: string[] = [];
      for (let i = 0; i < MODIFIERS.length; i++) {
        if (bitmask & (1 << i)) result.push(MODIFIERS[i]);
      }
      return result;
    };

    // For each symbol, find its corresponding semantic token and check modifiers
    const spikeContent = readFileSync(join(tempDir, "exports.ts"), "utf-8");
    const spikeLines = spikeContent.split("\n");

    // Collect modifier sets for exported vs non-exported symbols
    const exportedModifiers: string[][] = [];
    const nonExportedModifiers: string[][] = [];

    for (const sym of symbols) {
      // Find the semantic token that corresponds to this symbol's name
      const symLine = sym.selectionRange.start.line;
      const symChar = sym.selectionRange.start.character;
      const symLength = sym.name.length;

      const matchingToken = tokenResult.tokens.find(
        (t: SemanticToken) =>
          t.line === symLine && t.startChar === symChar && t.length === symLength,
      );

      if (!matchingToken) continue;

      const mods = decodeModifiers(matchingToken.tokenModifiers);
      const isExp = isExported(sym, spikeLines);

      if (isExp) {
        exportedModifiers.push(mods);
      } else {
        nonExportedModifiers.push(mods);
      }
    }

    // The spike finding: exported and non-exported symbols have the same modifiers.
    // Both typically just have "declaration". There is NO "exported" modifier.
    // This confirms text scanning is the correct strategy.
    //
    // If this assertion ever fails (i.e., the sets differ), it means the LS
    // added export-aware modifiers and we should switch to semantic tokens.
    const exportedSets = new Set(exportedModifiers.map((m) => m.sort().join(",")));
    const nonExportedSets = new Set(nonExportedModifiers.map((m) => m.sort().join(",")));

    // Core assertion: the modifier sets overlap — semantic tokens can't tell them apart
    const hasOverlap = [...exportedSets].some((s) => nonExportedSets.has(s));
    expect(hasOverlap).toBe(true);
  }, 30_000);
});
