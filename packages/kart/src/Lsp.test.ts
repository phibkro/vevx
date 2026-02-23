import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, realpathSync } from "node:fs";
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
    // realpathSync resolves /tmp → /private/tmp on macOS, avoiding URI mismatches with LSP
    tempDir = realpathSync(await mkdtemp(join("/tmp/claude/", "kart-lsp-")));
    const fixturePath = join(tempDir, "fixture.ts");
    await writeFile(fixturePath, FIXTURE_TS);
    await writeFile(join(tempDir, "tsconfig.json"), TSCONFIG);
    fixtureUri = `file://${fixturePath}`;

    // Create caller.ts upfront so tests don't depend on execution order
    await writeFile(
      join(tempDir, "caller.ts"),
      `import { greet, User } from "./fixture.js";\n\nexport function welcome(u: User) {\n  return greet(u);\n}\n`,
    );

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

  test("prepareCallHierarchy returns items for a function", async () => {
    // greet is at line 6, character 16 (export function greet)
    const items = await runtime.runPromise(
      Effect.gen(function* () {
        const lsp = yield* LspClient;
        return yield* lsp.prepareCallHierarchy(fixtureUri, 6, 16);
      }),
    );

    expect(items.length).toBeGreaterThan(0);
    expect(items[0].name).toBe("greet");
  }, 30_000);

  test("incomingCalls returns callers", async () => {
    const callerUri = `file://${join(tempDir, "caller.ts")}`;

    // Ensure LSP knows about the caller file by opening it
    await runtime.runPromise(
      Effect.gen(function* () {
        const lsp = yield* LspClient;
        yield* lsp.documentSymbol(callerUri);
      }),
    );

    // Get the call hierarchy item for greet
    const items = await runtime.runPromise(
      Effect.gen(function* () {
        const lsp = yield* LspClient;
        return yield* lsp.prepareCallHierarchy(fixtureUri, 6, 16);
      }),
    );
    expect(items.length).toBeGreaterThan(0);

    // Retry incomingCalls until LSP has cross-referenced (replaces fixed sleep)
    let calls: { from: { name: string } }[] = [];
    for (let attempt = 0; attempt < 10; attempt++) {
      calls = await runtime.runPromise(
        Effect.gen(function* () {
          const lsp = yield* LspClient;
          return yield* lsp.incomingCalls(items[0]);
        }),
      );
      if (calls.length > 0) break;
      await new Promise((r) => setTimeout(r, 300));
    }

    expect(calls.length).toBeGreaterThan(0);
    const callerNames = calls.map((c) => c.from.name);
    expect(callerNames).toContain("welcome");
  }, 30_000);

  test("outgoingCalls returns callees", async () => {
    const callerUri = `file://${join(tempDir, "caller.ts")}`;

    // Get document symbols to find welcome's position
    const symbols = await runtime.runPromise(
      Effect.gen(function* () {
        const lsp = yield* LspClient;
        return yield* lsp.documentSymbol(callerUri);
      }),
    );
    const welcome = symbols.find((s) => s.name === "welcome");
    expect(welcome).toBeDefined();

    const items = await runtime.runPromise(
      Effect.gen(function* () {
        const lsp = yield* LspClient;
        return yield* lsp.prepareCallHierarchy(
          callerUri,
          welcome!.selectionRange.start.line,
          welcome!.selectionRange.start.character,
        );
      }),
    );
    expect(items.length).toBeGreaterThan(0);
    expect(items[0].name).toBe("welcome");

    const outgoing = await runtime.runPromise(
      Effect.gen(function* () {
        const lsp = yield* LspClient;
        return yield* lsp.outgoingCalls(items[0]);
      }),
    );

    expect(outgoing.length).toBeGreaterThan(0);
    const calleeNames = outgoing.map((c) => c.to.name);
    expect(calleeNames).toContain("greet");
  }, 30_000);

  test("hover returns type information for a function", async () => {
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const lsp = yield* LspClient;
        // greet is at line 6 in FIXTURE_TS
        return yield* lsp.hover(fixtureUri, 6, 16);
      }),
    );

    expect(result).not.toBeNull();
    expect(result!.contents).toContain("greet");
    expect(result!.contents).toContain("string");
  }, 30_000);

  test("definition returns location for a function", async () => {
    const locations = await runtime.runPromise(
      Effect.gen(function* () {
        const lsp = yield* LspClient;
        // greet is at line 6 in FIXTURE_TS
        return yield* lsp.definition(fixtureUri, 6, 16);
      }),
    );

    expect(locations.length).toBeGreaterThanOrEqual(1);
    expect(locations[0].uri).toBe(fixtureUri);
  }, 30_000);

  test("definition follows cross-file references", async () => {
    const callerUri = `file://${join(tempDir, "caller.ts")}`;

    // Open caller.ts first
    await runtime.runPromise(
      Effect.gen(function* () {
        const lsp = yield* LspClient;
        yield* lsp.documentSymbol(callerUri);
      }),
    );

    // Find definition of 'greet' usage in caller.ts (line 3, where greet is called)
    const locations = await runtime.runPromise(
      Effect.gen(function* () {
        const lsp = yield* LspClient;
        return yield* lsp.definition(callerUri, 3, 9);
      }),
    );

    expect(locations.length).toBeGreaterThanOrEqual(1);
    // Should point back to fixture.ts
    expect(locations[0].uri).toBe(fixtureUri);
  }, 30_000);

  test("typeDefinition returns type location for a variable", async () => {
    const typedFile = join(tempDir, "typed.ts");
    await writeFile(
      typedFile,
      'import { User } from "./fixture.js";\n\nconst u: User = { name: "test", age: 25 };\nexport { u };\n',
    );
    const typedUri = `file://${typedFile}`;

    const locations = await runtime.runPromise(
      Effect.gen(function* () {
        const lsp = yield* LspClient;
        yield* lsp.documentSymbol(typedUri);
        // 'u' is on line 2
        return yield* lsp.typeDefinition(typedUri, 2, 6);
      }),
    );

    expect(locations.length).toBeGreaterThanOrEqual(1);
    // Should point to User interface in fixture.ts
    expect(locations[0].uri).toBe(fixtureUri);
  }, 30_000);

  test("implementation returns implementing classes", async () => {
    const ifacePath = join(tempDir, "iface.ts");
    await writeFile(
      ifacePath,
      "export interface Greeter {\n  greet(): string;\n}\n\nexport class FriendlyGreeter implements Greeter {\n  greet() { return 'Hi!'; }\n}\n",
    );
    const ifaceUri = `file://${ifacePath}`;

    const locations = await runtime.runPromise(
      Effect.gen(function* () {
        const lsp = yield* LspClient;
        yield* lsp.documentSymbol(ifaceUri);
        // Greeter interface at line 0
        return yield* lsp.implementation(ifaceUri, 0, 17);
      }),
    );

    expect(locations.length).toBeGreaterThanOrEqual(1);
  }, 30_000);

  test("codeAction returns available actions", async () => {
    const actions = await runtime.runPromise(
      Effect.gen(function* () {
        const lsp = yield* LspClient;
        return yield* lsp.codeAction(fixtureUri, {
          start: { line: 6, character: 0 },
          end: { line: 8, character: 1 },
        });
      }),
    );

    // May return 0 or more actions depending on LSP capabilities
    expect(Array.isArray(actions)).toBe(true);
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
