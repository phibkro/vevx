import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

mkdirSync("/tmp/claude", { recursive: true });

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createServer, errorMessage } from "./Mcp.js";

// ── Helpers ──

function parseResult(result: unknown): unknown {
  return JSON.parse((result as { content: { text: string }[] }).content[0].text);
}

function createFixtureDb(dbPath: string): void {
  const db = new Database(dbPath, { create: true });
  db.run(`
    CREATE TABLE artifacts (
      id INTEGER PRIMARY KEY,
      path TEXT NOT NULL UNIQUE
    )
  `);
  db.run(`
    CREATE TABLE co_change_edges (
      artifact_a INTEGER REFERENCES artifacts(id),
      artifact_b INTEGER REFERENCES artifacts(id),
      weight REAL NOT NULL
    )
  `);
  db.run("INSERT INTO artifacts (id, path) VALUES (1, 'src/a.ts')");
  db.run("INSERT INTO artifacts (id, path) VALUES (2, 'src/b.ts')");
  db.run("INSERT INTO artifacts (id, path) VALUES (3, 'src/c.ts')");
  db.run("INSERT INTO co_change_edges (artifact_a, artifact_b, weight) VALUES (1, 2, 3.0)");
  db.run("INSERT INTO co_change_edges (artifact_a, artifact_b, weight) VALUES (1, 2, 2.0)");
  db.run("INSERT INTO co_change_edges (artifact_a, artifact_b, weight) VALUES (1, 3, 2.0)");
  db.close();
}

// ── errorMessage unit tests (no LSP needed) ──

describe("errorMessage", () => {
  test("extracts _tag + path from FiberFailure with TaggedError", () => {
    const sym = Symbol.for("effect/Runtime/FiberFailure/Cause");
    const err = Object.assign(new Error("An error has occurred"), {
      [sym]: {
        _tag: "Fail",
        error: { _tag: "FileNotFoundError", path: "/tmp/missing.ts" },
      },
    });
    expect(errorMessage(err)).toBe("FileNotFoundError: /tmp/missing.ts");
  });

  test("extracts _tag + message from FiberFailure when no path field", () => {
    const sym = Symbol.for("effect/Runtime/FiberFailure/Cause");
    const err = Object.assign(new Error("An error has occurred"), {
      [sym]: {
        _tag: "Fail",
        error: { _tag: "LspError", message: "connection refused" },
      },
    });
    expect(errorMessage(err)).toBe("LspError: connection refused");
  });

  test("returns just _tag when message is the default", () => {
    const sym = Symbol.for("effect/Runtime/FiberFailure/Cause");
    const err = Object.assign(new Error("An error has occurred"), {
      [sym]: {
        _tag: "Fail",
        error: { _tag: "LspTimeoutError", message: "An error has occurred" },
      },
    });
    expect(errorMessage(err)).toBe("LspTimeoutError");
  });

  test("falls back to Error.message for plain errors", () => {
    expect(errorMessage(new Error("something broke"))).toBe("something broke");
  });

  test("falls back to String() for non-objects", () => {
    expect(errorMessage("raw string")).toBe("raw string");
    expect(errorMessage(42)).toBe("42");
    expect(errorMessage(null)).toBe("null");
  });
});

// ── LSP availability ──

const hasLsp = Bun.which("typescript-language-server") !== null && !process.env.TURBO_HASH;

// ── Cochange tests (no LSP needed) ──

describe("MCP integration — kart_cochange", () => {
  let client: Client;
  let tempDir: string;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    tempDir = await mkdtemp(join("/tmp/claude/", "kart-mcp-cochange-"));
    const dbPath = join(tempDir, "cochange.db");
    createFixtureDb(dbPath);

    const server = createServer({ dbPath, rootDir: tempDir });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "test-cochange", version: "0.1.0" });

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    cleanup = async () => {
      await Promise.all([server.close(), client.close()]);
      await rm(tempDir, { recursive: true, force: true });
    };
  });

  afterAll(async () => {
    await cleanup();
  });

  test("returns neighbors ranked by coupling score", async () => {
    const result = await client.callTool({
      name: "kart_cochange",
      arguments: { path: "src/a.ts" },
    });
    const data = parseResult(result) as {
      path: string;
      neighbors: { path: string; score: number; commits: number }[];
    };
    expect(data.path).toBe("src/a.ts");
    expect(data.neighbors).toEqual([
      { path: "src/b.ts", score: 5, commits: 2 },
      { path: "src/c.ts", score: 2, commits: 1 },
    ]);
  });

  test("returns CochangeUnavailable when no db exists", async () => {
    // Create a server pointing at a nonexistent db
    const noDbServer = createServer({
      dbPath: join(tempDir, "nonexistent.db"),
      rootDir: tempDir,
    });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const noDbClient = new Client({ name: "test-nodb", version: "0.1.0" });

    await Promise.all([noDbServer.connect(st), noDbClient.connect(ct)]);

    try {
      const result = await noDbClient.callTool({
        name: "kart_cochange",
        arguments: { path: "src/a.ts" },
      });
      const data = parseResult(result) as { error: string; message: string };
      expect(data.error).toBe("co_change_data_unavailable");
      expect(data.message).toContain("co-change data not found");
      // Not an MCP-level error
      expect((result as { isError?: boolean }).isError).toBeFalsy();
    } finally {
      await Promise.all([noDbServer.close(), noDbClient.close()]);
    }
  });
});

// ── Tool listing ──

describe("MCP integration — tool listing", () => {
  let client: Client;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    const tempDir = await mkdtemp(join("/tmp/claude/", "kart-mcp-list-"));
    const server = createServer({ dbPath: join(tempDir, "x.db"), rootDir: tempDir });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "test-list", version: "0.1.0" });
    await Promise.all([server.connect(st), client.connect(ct)]);

    cleanup = async () => {
      await Promise.all([server.close(), client.close()]);
      await rm(tempDir, { recursive: true, force: true });
    };
  });

  afterAll(async () => {
    await cleanup();
  });

  test("lists all kart tools", async () => {
    const result = await client.listTools();
    const names = result.tools.map((t) => t.name).sort();
    expect(names).toEqual(["kart_cochange", "kart_impact", "kart_zoom"]);
  });

  test("all tools have read-only annotations", async () => {
    const result = await client.listTools();
    for (const tool of result.tools) {
      expect(tool.annotations).toBeDefined();
      expect(tool.annotations!.readOnlyHint).toBe(true);
      expect(tool.annotations!.destructiveHint).toBe(false);
    }
  });
});

// ── Zoom tests (require LSP) ──

describe.skipIf(!hasLsp)("MCP integration — kart_zoom", () => {
  let client: Client;
  let tempDir: string;
  let cleanup: () => Promise<void>;

  const FIXTURE_TS = `
export function greet(name: string): string {
  return \`Hello \${name}\`;
}

export const MAX = 100;

function internal() {}
`;

  beforeAll(async () => {
    tempDir = await mkdtemp(join("/tmp/claude/", "kart-mcp-zoom-"));

    // Set up a minimal TS project so the language server works
    await writeFile(join(tempDir, "fixture.ts"), FIXTURE_TS);
    await writeFile(
      join(tempDir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "bundler" },
        include: ["*.ts"],
      }),
    );

    // Symlink typescript into temp dir so the language server can find it
    const repoRoot = resolve(import.meta.dir, "../../..");
    const typescriptSrc = join(repoRoot, "node_modules", "typescript");
    await mkdir(join(tempDir, "node_modules"), { recursive: true });
    await symlink(typescriptSrc, join(tempDir, "node_modules", "typescript"));

    const server = createServer({
      dbPath: join(tempDir, "no.db"),
      rootDir: tempDir,
    });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "test-zoom", version: "0.1.0" });

    await Promise.all([server.connect(st), client.connect(ct)]);

    cleanup = async () => {
      await Promise.all([server.close(), client.close()]);
      await rm(tempDir, { recursive: true, force: true });
    };
  }, 30_000);

  afterAll(async () => {
    await cleanup();
  });

  test("level 0 returns only exported symbols", async () => {
    const filePath = join(tempDir, "fixture.ts");
    const result = await client.callTool({
      name: "kart_zoom",
      arguments: { path: filePath, level: 0 },
    });
    const data = parseResult(result) as { symbols: { name: string; exported: boolean }[] };
    // All returned symbols should be exported
    for (const sym of data.symbols) {
      expect(sym.exported).toBe(true);
    }
    // Should include greet and MAX
    const names = data.symbols.map((s) => s.name);
    expect(names).toContain("greet");
    expect(names).toContain("MAX");
    // Should NOT include internal
    expect(names).not.toContain("internal");
  });

  test("level 2 returns full file content", async () => {
    const filePath = join(tempDir, "fixture.ts");
    const result = await client.callTool({
      name: "kart_zoom",
      arguments: { path: filePath, level: 2 },
    });
    const data = parseResult(result) as {
      level: number;
      symbols: { signature: string }[];
      truncated: boolean;
    };
    expect(data.level).toBe(2);
    expect(data.truncated).toBe(false);
    // Full content mode: the signature field contains the whole file
    expect(data.symbols[0].signature).toContain("export function greet");
    expect(data.symbols[0].signature).toContain("function internal");
  });

  test("returns error for nonexistent file", async () => {
    const result = await client.callTool({
      name: "kart_zoom",
      arguments: { path: join(tempDir, "no-such-file.ts"), level: 0 },
    });
    expect((result as { isError?: boolean }).isError).toBe(true);
    const text = (result as { content: { text: string }[] }).content[0].text;
    expect(text).toContain("Error");
  });

  // ── kart_impact tests (reuse the same LSP-enabled server) ──

  test("kart_impact returns transitive callers", async () => {
    // Create a caller file
    await writeFile(
      join(tempDir, "caller.ts"),
      `import { greet } from "./fixture.js";\n\nexport function welcome() {\n  return greet("world");\n}\n`,
    );
    // Give watcher time
    await new Promise((r) => setTimeout(r, 1000));

    // Open the caller file so LSP knows about it
    await client.callTool({
      name: "kart_zoom",
      arguments: { path: join(tempDir, "caller.ts"), level: 0 },
    });

    // Wait for LSP to cross-reference
    await new Promise((r) => setTimeout(r, 1000));

    const result = await client.callTool({
      name: "kart_impact",
      arguments: {
        path: join(tempDir, "fixture.ts"),
        symbol: "greet",
      },
    });

    expect((result as { isError?: boolean }).isError).toBeFalsy();
    const data = parseResult(result) as {
      symbol: string;
      depth: number;
      maxDepth: number;
      totalNodes: number;
      highFanOut: boolean;
      root: { name: string; fanOut: number; callers: { name: string }[] };
    };

    expect(data.symbol).toBe("greet");
    expect(data.depth).toBe(3);
    expect(data.maxDepth).toBe(5);
    expect(data.totalNodes).toBeGreaterThanOrEqual(2); // root + at least 1 caller
    expect(data.highFanOut).toBe(false);
    expect(data.root.name).toBe("greet");
    const callerNames = data.root.callers.map((c) => c.name);
    expect(callerNames).toContain("welcome");
  }, 30_000);

  test("kart_impact returns structuredContent", async () => {
    const result = await client.callTool({
      name: "kart_impact",
      arguments: {
        path: join(tempDir, "fixture.ts"),
        symbol: "greet",
      },
    });

    const typed = result as { structuredContent?: { symbol: string } };
    expect(typed.structuredContent).toBeDefined();
    expect(typed.structuredContent!.symbol).toBe("greet");
  }, 30_000);

  test("kart_impact returns error for unknown symbol", async () => {
    const result = await client.callTool({
      name: "kart_impact",
      arguments: {
        path: join(tempDir, "fixture.ts"),
        symbol: "nonexistent",
      },
    });
    expect((result as { isError?: boolean }).isError).toBe(true);
    const text = (result as { content: { text: string }[] }).content[0].text;
    expect(text).toContain("nonexistent");
  }, 30_000);

  test("kart_impact respects custom depth", async () => {
    const result = await client.callTool({
      name: "kart_impact",
      arguments: {
        path: join(tempDir, "fixture.ts"),
        symbol: "greet",
        depth: 1,
      },
    });

    expect((result as { isError?: boolean }).isError).toBeFalsy();
    const data = parseResult(result) as { depth: number };
    expect(data.depth).toBe(1);
  }, 30_000);
});
