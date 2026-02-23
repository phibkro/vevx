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
    expect(names).toEqual([
      "kart_cochange",
      "kart_code_actions",
      "kart_definition",
      "kart_deps",
      "kart_diagnostics",
      "kart_expand_macro",
      "kart_find",
      "kart_impact",
      "kart_implementation",
      "kart_importers",
      "kart_imports",
      "kart_inlay_hints",
      "kart_insert_after",
      "kart_insert_before",
      "kart_list",
      "kart_references",
      "kart_rename",
      "kart_replace",
      "kart_restart",
      "kart_search",
      "kart_type_definition",
      "kart_unused_exports",
      "kart_workspace_symbol",
      "kart_zoom",
    ]);
  });

  test("read-only tools have read-only annotations", async () => {
    const result = await client.listTools();
    const nonReadOnly = new Set([
      "kart_replace",
      "kart_insert_after",
      "kart_insert_before",
      "kart_rename",
      "kart_restart",
    ]);
    const readOnlyTools = result.tools.filter((t) => !nonReadOnly.has(t.name));
    for (const tool of readOnlyTools) {
      expect(tool.annotations).toBeDefined();
      expect(tool.annotations!.readOnlyHint).toBe(true);
      expect(tool.annotations!.destructiveHint).toBe(false);
    }
  });

  test("edit tools have read-write annotations", async () => {
    const result = await client.listTools();
    const writeToolNames = new Set([
      "kart_replace",
      "kart_insert_after",
      "kart_insert_before",
      "kart_rename",
    ]);
    const editTools = result.tools.filter((t) => writeToolNames.has(t.name));
    expect(editTools).toHaveLength(4);
    for (const tool of editTools) {
      expect(tool.annotations).toBeDefined();
      expect(tool.annotations!.readOnlyHint).toBe(false);
    }
  });
});

// ── kart_find tests (no LSP needed) ──

describe("MCP integration — kart_find", () => {
  let client: Client;
  let tempDir: string;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    tempDir = await mkdtemp(join("/tmp/claude/", "kart-mcp-find-"));

    // Write fixture files
    await writeFile(
      join(tempDir, "greeting.ts"),
      `export function greet(name: string): string {\n  return \`Hello \${name}\`;\n}\n\nexport const MAX = 100;\n\nfunction internal() {}\n`,
    );
    await mkdir(join(tempDir, "models"), { recursive: true });
    await writeFile(
      join(tempDir, "models", "user.ts"),
      `export interface User {\n  id: string;\n  name: string;\n}\n\nexport interface Admin extends User {\n  role: string;\n}\n`,
    );

    const server = createServer({ dbPath: join(tempDir, "no.db"), rootDir: tempDir });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "test-find", version: "0.1.0" });

    await Promise.all([server.connect(st), client.connect(ct)]);

    cleanup = async () => {
      await Promise.all([server.close(), client.close()]);
      await rm(tempDir, { recursive: true, force: true });
    };
  });

  afterAll(async () => {
    await cleanup();
  });

  test("returns symbols from workspace by name", async () => {
    const result = await client.callTool({
      name: "kart_find",
      arguments: { name: "greet" },
    });
    const data = parseResult(result) as { symbols: { name: string; file: string }[] };
    expect(data.symbols).toHaveLength(1);
    expect(data.symbols[0].name).toBe("greet");
    expect(data.symbols[0].file).toBe("greeting.ts");
  });

  test("filters by kind", async () => {
    const result = await client.callTool({
      name: "kart_find",
      arguments: { name: "", kind: "interface" },
    });
    const data = parseResult(result) as { symbols: { name: string; kind: string }[] };
    expect(data.symbols.length).toBeGreaterThanOrEqual(2);
    for (const sym of data.symbols) {
      expect(sym.kind).toBe("interface");
    }
  });

  test("returns metadata fields", async () => {
    const result = await client.callTool({
      name: "kart_find",
      arguments: { name: "" },
    });
    const data = parseResult(result) as {
      fileCount: number;
    };
    expect(data.fileCount).toBeGreaterThanOrEqual(2);
    // durationMs and cachedFiles are stripped for context efficiency
    expect((data as Record<string, unknown>).durationMs).toBeUndefined();
    expect((data as Record<string, unknown>).cachedFiles).toBeUndefined();
  });
});

// ── kart_imports / kart_importers tests (no LSP needed) ──

describe("MCP integration — kart_imports / kart_importers", () => {
  let client: Client;
  let tempDir: string;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    tempDir = await mkdtemp(join("/tmp/claude/", "kart-mcp-imports-"));

    await writeFile(
      join(tempDir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "bundler" },
      }),
    );
    await writeFile(join(tempDir, "a.ts"), 'import { greet } from "./b.js";\nconst x = 1;\n');
    await writeFile(join(tempDir, "b.ts"), "export function greet() {}\n");

    const server = createServer({ dbPath: join(tempDir, "no.db"), rootDir: tempDir });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "test-imports", version: "0.1.0" });

    await Promise.all([server.connect(st), client.connect(ct)]);

    cleanup = async () => {
      await Promise.all([server.close(), client.close()]);
      await rm(tempDir, { recursive: true, force: true });
    };
  });

  afterAll(async () => {
    await cleanup();
  });

  test("kart_imports returns imports for a file", async () => {
    const result = await client.callTool({
      name: "kart_imports",
      arguments: { path: join(tempDir, "a.ts") },
    });
    const data = parseResult(result) as { imports: { specifier: string }[]; totalImports: number };
    expect(data.totalImports).toBeGreaterThanOrEqual(1);
    expect(data.imports.some((i) => i.specifier === "./b.js")).toBe(true);
  });

  test("kart_importers returns importers of a file", async () => {
    const result = await client.callTool({
      name: "kart_importers",
      arguments: { path: join(tempDir, "b.ts") },
    });
    const data = parseResult(result) as {
      directImporters: string[];
      totalImporters: number;
    };
    expect(data.totalImporters).toBeGreaterThanOrEqual(1);
    expect(data.directImporters.some((p) => p.endsWith("a.ts"))).toBe(true);
  });
});

// ── kart_restart tests ──

describe("MCP integration — kart_restart", () => {
  let client: Client;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    const server = createServer({ rootDir: "/tmp" });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    client = new Client({ name: "test", version: "0.0.1" });
    await client.connect(ct);
    cleanup = async () => {
      await client.close();
      await server.close();
    };
  });

  afterAll(async () => {
    await cleanup();
  });

  test("kart_restart returns success", async () => {
    const result = await client.callTool({ name: "kart_restart", arguments: {} });
    const data = parseResult(result) as { restarted: boolean; rootDir: string };
    expect(data.restarted).toBe(true);
    expect(data.rootDir).toBe("/tmp");
  });
});

// ── kart_search tests (no LSP needed) ──

describe("MCP integration — kart_search", () => {
  let client: Client;
  let tempDir: string;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    tempDir = await mkdtemp(join("/tmp/claude/", "kart-mcp-search-"));

    // git init so rg respects gitignore
    Bun.spawnSync(["git", "init"], { cwd: tempDir });

    await writeFile(
      join(tempDir, "greeting.ts"),
      `export function greet(name: string): string {\n  return \`Hello \${name}\`;\n}\n\nexport const MAX = 100;\n\nfunction internal() {}\n`,
    );
    await mkdir(join(tempDir, "models"), { recursive: true });
    await writeFile(
      join(tempDir, "models", "user.ts"),
      `export interface User {\n  id: string;\n  name: string;\n}\n`,
    );

    const server = createServer({ dbPath: join(tempDir, "no.db"), rootDir: tempDir });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "test-search", version: "0.1.0" });

    await Promise.all([server.connect(st), client.connect(ct)]);

    cleanup = async () => {
      await Promise.all([server.close(), client.close()]);
      await rm(tempDir, { recursive: true, force: true });
    };
  });

  afterAll(async () => {
    await cleanup();
  });

  test("finds pattern in workspace", async () => {
    const result = await client.callTool({
      name: "kart_search",
      arguments: { pattern: "greet" },
    });
    const data = parseResult(result) as {
      matches: { path: string; line: number; text: string }[];
      truncated: boolean;
    };
    expect(data.matches.length).toBeGreaterThanOrEqual(1);
    expect(data.matches.some((m) => m.path === "greeting.ts")).toBe(true);
    expect(data.truncated).toBe(false);
  });
});

// ── kart_list tests (no LSP needed) ──

describe("MCP integration — kart_list", () => {
  let client: Client;
  let tempDir: string;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    tempDir = await mkdtemp(join("/tmp/claude/", "kart-mcp-list-"));
    await mkdir(join(tempDir, "src"), { recursive: true });
    await writeFile(join(tempDir, "src", "app.ts"), "export function app() {}");
    await writeFile(join(tempDir, "src", "util.ts"), "export const x = 1;");

    const server = createServer({ rootDir: tempDir });
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

  test("lists directory contents", async () => {
    const result = await client.callTool({
      name: "kart_list",
      arguments: { path: "src" },
    });
    const data = parseResult(result) as { entries: { name: string }[]; truncated: boolean };
    const names = data.entries.map((e) => e.name);
    expect(names).toContain("app.ts");
    expect(names).toContain("util.ts");
    expect(data.truncated).toBe(false);
  });
});

// ── Edit tool tests (no LSP needed) ──

describe("MCP integration — kart edit tools", () => {
  let client: Client;
  let tempDir: string;
  let cleanup: () => Promise<void>;

  const TARGET_TS = `export function greet(name: string): string {
  return \`Hello \${name}\`;
}

export const MAX = 100;
`;

  beforeAll(async () => {
    tempDir = await mkdtemp(join("/tmp/claude/", "kart-mcp-edit-"));

    const server = createServer({ dbPath: join(tempDir, "no.db"), rootDir: tempDir });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "test-edit", version: "0.1.0" });

    await Promise.all([server.connect(st), client.connect(ct)]);

    cleanup = async () => {
      await Promise.all([server.close(), client.close()]);
      await rm(tempDir, { recursive: true, force: true });
    };
  });

  afterAll(async () => {
    await cleanup();
  });

  test("kart_replace replaces symbol content", async () => {
    const filePath = join(tempDir, "replace-target.ts");
    await writeFile(filePath, TARGET_TS);

    const result = await client.callTool({
      name: "kart_replace",
      arguments: {
        file: filePath,
        symbol: "greet",
        content: "export function greet(name: string): string {\n  return `Hi ${name}`;\n}",
      },
    });

    const data = parseResult(result) as { success: boolean; symbol: string; syntaxError: boolean };
    expect(data.success).toBe(true);
    expect(data.symbol).toBe("greet");
    expect(data.syntaxError).toBe(false);

    const { readFileSync } = await import("node:fs");
    const updated = readFileSync(filePath, "utf-8");
    expect(updated).toContain("Hi ${name}");
  });

  test("kart_replace rejects syntax errors", async () => {
    const filePath = join(tempDir, "syntax-target.ts");
    await writeFile(filePath, TARGET_TS);

    const result = await client.callTool({
      name: "kart_replace",
      arguments: {
        file: filePath,
        symbol: "greet",
        content: "export function greet( {{{",
      },
    });

    const data = parseResult(result) as { success: boolean; syntaxError: boolean };
    expect(data.success).toBe(false);
    expect(data.syntaxError).toBe(true);

    // File should be unchanged
    const { readFileSync } = await import("node:fs");
    const content = readFileSync(filePath, "utf-8");
    expect(content).toBe(TARGET_TS);
  });

  test("kart_insert_after inserts content", async () => {
    const filePath = join(tempDir, "after-target.ts");
    await writeFile(filePath, TARGET_TS);

    const result = await client.callTool({
      name: "kart_insert_after",
      arguments: {
        file: filePath,
        symbol: "greet",
        content: "\nexport function farewell(): string {\n  return 'Goodbye';\n}\n",
      },
    });

    const data = parseResult(result) as { success: boolean };
    expect(data.success).toBe(true);

    const { readFileSync } = await import("node:fs");
    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain("farewell");
    expect(content).toContain("greet");
  });

  test("kart_insert_before inserts content", async () => {
    const filePath = join(tempDir, "before-target.ts");
    await writeFile(filePath, TARGET_TS);

    const result = await client.callTool({
      name: "kart_insert_before",
      arguments: {
        file: filePath,
        symbol: "greet",
        content: "// Greeting function\n",
      },
    });

    const data = parseResult(result) as { success: boolean };
    expect(data.success).toBe(true);

    const { readFileSync } = await import("node:fs");
    const content = readFileSync(filePath, "utf-8");
    const commentIdx = content.indexOf("// Greeting function");
    const greetIdx = content.indexOf("export function greet");
    expect(commentIdx).toBeLessThan(greetIdx);
  });
});

// ── kart_diagnostics tests (no LSP needed) ──

describe("MCP integration — kart_diagnostics", () => {
  let client: Client;
  let tempDir: string;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    tempDir = await mkdtemp(join("/tmp/claude/", "kart-mcp-diag-"));
    await writeFile(join(tempDir, "code.ts"), "const x: any = 1;\nexport { x };\n");

    const server = createServer({ dbPath: join(tempDir, "no.db"), rootDir: tempDir });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "test-diag", version: "0.1.0" });

    await Promise.all([server.connect(st), client.connect(ct)]);

    cleanup = async () => {
      await Promise.all([server.close(), client.close()]);
      await rm(tempDir, { recursive: true, force: true });
    };
  });

  afterAll(async () => {
    await cleanup();
  });

  test("returns structured diagnostics result", async () => {
    const result = await client.callTool({
      name: "kart_diagnostics",
      arguments: { paths: ["code.ts"] },
    });
    const data = parseResult(result) as {
      diagnostics: unknown[];
      oxlintAvailable: boolean;
    };
    expect(typeof data.oxlintAvailable).toBe("boolean");
    expect(data.diagnostics).toBeInstanceOf(Array);
  });

  test("skips paths outside workspace root", async () => {
    const result = await client.callTool({
      name: "kart_diagnostics",
      arguments: { paths: ["../../../etc/passwd"] },
    });
    const data = parseResult(result) as {
      diagnostics: unknown[];
      pathsSkipped: string[];
    };
    expect(data.pathsSkipped).toEqual(["../../../etc/passwd"]);
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

  test("kart_definition returns definition location", async () => {
    const result = await client.callTool({
      name: "kart_definition",
      arguments: {
        path: join(tempDir, "fixture.ts"),
        symbol: "greet",
      },
    });

    expect((result as { isError?: boolean }).isError).toBeFalsy();
    const data = parseResult(result) as {
      symbol: string;
      definitions: { path: string; line: number }[];
      totalDefinitions: number;
    };
    expect(data.symbol).toBe("greet");
    expect(data.totalDefinitions).toBeGreaterThanOrEqual(1);
  }, 30_000);

  test("kart_implementation returns implementations", async () => {
    await writeFile(
      join(tempDir, "iface.ts"),
      "export interface Greeter {\n  greet(): string;\n}\n\nexport class FriendlyGreeter implements Greeter {\n  greet() { return 'Hi!'; }\n}\n",
    );
    await new Promise((r) => setTimeout(r, 1000));

    // Open the file first
    await client.callTool({
      name: "kart_zoom",
      arguments: { path: join(tempDir, "iface.ts"), level: 0 },
    });

    const result = await client.callTool({
      name: "kart_implementation",
      arguments: {
        path: join(tempDir, "iface.ts"),
        symbol: "Greeter",
      },
    });

    expect((result as { isError?: boolean }).isError).toBeFalsy();
    const data = parseResult(result) as {
      symbol: string;
      implementations: { path: string }[];
    };
    expect(data.symbol).toBe("Greeter");
  }, 30_000);

  test("kart_code_actions returns array", async () => {
    const result = await client.callTool({
      name: "kart_code_actions",
      arguments: {
        path: join(tempDir, "fixture.ts"),
        symbol: "greet",
      },
    });

    expect((result as { isError?: boolean }).isError).toBeFalsy();
    const data = parseResult(result) as { actions: unknown[]; totalActions: number };
    expect(Array.isArray(data.actions)).toBe(true);
  }, 30_000);

  test("kart_deps returns transitive callees", async () => {
    const result = await client.callTool({
      name: "kart_deps",
      arguments: {
        path: join(tempDir, "caller.ts"),
        symbol: "welcome",
      },
    });

    expect((result as { isError?: boolean }).isError).toBeFalsy();
    const data = parseResult(result) as {
      symbol: string;
      depth: number;
      maxDepth: number;
      totalNodes: number;
      root: { name: string; callees: { name: string }[] };
    };

    expect(data.symbol).toBe("welcome");
    expect(data.totalNodes).toBeGreaterThanOrEqual(1);
    expect(data.root.name).toBe("welcome");
  }, 30_000);

  test("kart_workspace_symbol finds symbols by name", async () => {
    const result = await client.callTool({
      name: "kart_workspace_symbol",
      arguments: { query: "greet" },
    });

    expect((result as { isError?: boolean }).isError).toBeFalsy();
    const data = parseResult(result) as {
      symbols: { name: string; kind: number; location: unknown }[];
    };
    expect(data.symbols.length).toBeGreaterThanOrEqual(1);
    const names = data.symbols.map((s) => s.name);
    expect(names).toContain("greet");
  }, 30_000);

  test("kart_inlay_hints returns hints for a file", async () => {
    const result = await client.callTool({
      name: "kart_inlay_hints",
      arguments: { path: join(tempDir, "fixture.ts") },
    });

    expect((result as { isError?: boolean }).isError).toBeFalsy();
    const data = parseResult(result) as {
      path: string;
      hints: unknown[];
    };
    expect(data.path).toContain("fixture.ts");
    expect(Array.isArray(data.hints)).toBe(true);
  }, 30_000);

  test("kart_expand_macro rejects non-Rust files", async () => {
    const result = await client.callTool({
      name: "kart_expand_macro",
      arguments: {
        path: join(tempDir, "fixture.ts"),
        symbol: "greet",
      },
    });

    expect((result as { isError?: boolean }).isError).toBe(true);
    const text = (result as { content: { text: string }[] }).content[0].text;
    expect(text).toContain("Rust");
  }, 30_000);
});
