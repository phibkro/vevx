import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { Effect, ManagedRuntime } from "effect";

import { LspClient, LspClientLive } from "./Lsp.js";

// ── Skip check ──

const hasLsp = Bun.which("typescript-language-server") !== null;

// ── Fixture ──

const FIXTURE_TS = `
export interface User {
  name: string;
  age: number;
}

export function greet(user: User): string {
  return \`Hello, \${user.name}\`;
}

export const MAX_AGE = 150;
`;

const TSCONFIG = JSON.stringify({
  compilerOptions: {
    target: "ES2022",
    module: "ESNext",
    moduleResolution: "bundler",
    strict: true,
  },
  include: ["*.ts"],
});

// ── Tests ──

describe.skipIf(!hasLsp)("LspClient", () => {
  let tempDir: string;
  let fixtureUri: string;
  let runtime: ManagedRuntime.ManagedRuntime<LspClient, never>;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "kart-lsp-"));
    const fixturePath = join(tempDir, "fixture.ts");
    await writeFile(fixturePath, FIXTURE_TS);
    await writeFile(join(tempDir, "tsconfig.json"), TSCONFIG);
    fixtureUri = `file://${fixturePath}`;

    // Symlink typescript into temp dir so the LS can find it
    const repoRoot = resolve(import.meta.dir, "../../..");
    const typescriptSrc = join(repoRoot, "node_modules", "typescript");
    await mkdir(join(tempDir, "node_modules"), { recursive: true });
    await symlink(typescriptSrc, join(tempDir, "node_modules", "typescript"));

    runtime = ManagedRuntime.make(LspClientLive({ rootDir: tempDir }));
    // Force layer initialization
    await runtime.runPromise(Effect.void);
  }, 30_000);

  afterAll(async () => {
    if (runtime) {
      await runtime.dispose();
    }
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  }, 15_000);

  test("documentSymbol returns expected symbols from fixture", async () => {
    const symbols = await runtime.runPromise(
      Effect.gen(function* () {
        const lsp = yield* LspClient;
        return yield* lsp.documentSymbol(fixtureUri);
      }),
    );

    const names = symbols.map((s) => s.name);
    expect(names).toContain("User");
    expect(names).toContain("greet");
    expect(names).toContain("MAX_AGE");
  }, 30_000);

  test("documentSymbol returns hierarchical children for interface", async () => {
    const symbols = await runtime.runPromise(
      Effect.gen(function* () {
        const lsp = yield* LspClient;
        return yield* lsp.documentSymbol(fixtureUri);
      }),
    );

    const userSymbol = symbols.find((s) => s.name === "User");
    expect(userSymbol).toBeDefined();
    expect(userSymbol!.children).toBeDefined();
    const childNames = userSymbol!.children!.map((c) => c.name);
    expect(childNames).toContain("name");
    expect(childNames).toContain("age");
  }, 30_000);

  test("semanticTokens returns non-empty tokens", async () => {
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const lsp = yield* LspClient;
        return yield* lsp.semanticTokens(fixtureUri);
      }),
    );

    expect(result.tokens.length).toBeGreaterThan(0);
    for (const token of result.tokens) {
      expect(token.line).toBeGreaterThanOrEqual(0);
      expect(token.length).toBeGreaterThan(0);
    }
  }, 30_000);
});
