import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

mkdirSync("/tmp/claude", { recursive: true });

import { Effect, ManagedRuntime } from "effect";

import { LspClient, LspClientLive } from "./Lsp.js";

// ── Skip check ──

const hasLsp = Bun.which("typescript-language-server") !== null && !process.env.TURBO_HASH;

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
    tempDir = await mkdtemp(join("/tmp/claude/", "kart-lsp-"));
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

  test("LSP picks up didChange notification for open document", async () => {
    // Get initial symbols — this opens the document
    const initial = await runtime.runPromise(
      Effect.gen(function* () {
        const lsp = yield* LspClient;
        return yield* lsp.documentSymbol(fixtureUri);
      }),
    );
    const initialNames = initial.map((s) => s.name);
    expect(initialNames).toContain("greet");
    expect(initialNames).not.toContain("farewell");

    // Update the file and use updateOpenDocument to notify the LSP
    const updatedContent =
      FIXTURE_TS +
      `\nexport function farewell(user: User): string {\n  return \`Goodbye, \${user.name}\`;\n}\n`;
    const fixturePath = fixtureUri.slice(7);
    await writeFile(fixturePath, updatedContent);

    // Notify LSP via updateOpenDocument (exposed on LspClient)
    await runtime.runPromise(
      Effect.gen(function* () {
        const lsp = yield* LspClient;
        yield* lsp.updateOpenDocument(fixtureUri);
      }),
    );

    // Give LSP a moment to process
    await new Promise((r) => setTimeout(r, 1000));

    // Re-query — should see the new symbol
    const updated = await runtime.runPromise(
      Effect.gen(function* () {
        const lsp = yield* LspClient;
        return yield* lsp.documentSymbol(fixtureUri);
      }),
    );
    const updatedNames = updated.map((s) => s.name);
    expect(updatedNames).toContain("farewell");
  }, 30_000);

  test("shutdown() terminates the language server cleanly", async () => {
    // Separate runtime — shutdown kills the process, can't reuse the shared one
    const shutdownRuntime = ManagedRuntime.make(LspClientLive({ rootDir: tempDir }));
    try {
      // Verify it works before shutdown
      const symbols = await shutdownRuntime.runPromise(
        Effect.gen(function* () {
          const lsp = yield* LspClient;
          return yield* lsp.documentSymbol(fixtureUri);
        }),
      );
      expect(symbols.length).toBeGreaterThan(0);

      // Explicit shutdown should complete without error
      await shutdownRuntime.runPromise(
        Effect.gen(function* () {
          const lsp = yield* LspClient;
          yield* lsp.shutdown();
        }),
      );
    } finally {
      await shutdownRuntime.dispose();
    }
  }, 30_000);
});
