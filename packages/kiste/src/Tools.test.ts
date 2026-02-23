import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { SqliteClient } from "@effect/sql-sqlite-bun";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Effect, Layer } from "effect";
import * as Schema from "effect/Schema";

import { Config, ConfigSchema } from "./Config.js";
import { initSchema } from "./Db.js";
import { GitLive } from "./Git.js";
import { rebuildIndex } from "./Indexer.js";
import { createServer } from "./Mcp.js";

// ── Helpers ──

function git(cwd: string, ...args: string[]) {
  const result = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (!result.success) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString()}`);
  return result.stdout.toString().trim();
}

function makeTempDir(): string {
  return mkdtempSync("/tmp/claude/kiste-mcp-test-");
}

function initRepo(cwd: string): void {
  git(cwd, "init");
  git(cwd, "config", "user.email", "test@test.com");
  git(cwd, "config", "user.name", "Test");
}

function writeFile(cwd: string, relPath: string, content: string): void {
  const fullPath = join(cwd, relPath);
  const dir = fullPath.substring(0, fullPath.lastIndexOf("/"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(fullPath, content);
}

function makeTestLayer(cwd: string) {
  const dbPath = join(cwd, ".kiste", "index.sqlite");
  Bun.spawnSync(["mkdir", "-p", join(cwd, ".kiste")], { cwd });
  return Layer.mergeAll(
    Layer.succeed(Config, Schema.decodeUnknownSync(ConfigSchema)({})),
    SqliteClient.layer({ filename: dbPath }),
    GitLive,
  );
}

// ── Test Suite ──

describe("MCP Tools", () => {
  let tmpDir: string;
  let client: Client;

  beforeEach(async () => {
    // 1. Create temp repo with a file
    tmpDir = makeTempDir();
    const dbPath = join(tmpDir, ".kiste", "index.sqlite");

    initRepo(tmpDir);
    writeFile(tmpDir, "src/auth/login.ts", 'export const login = () => "authenticated";');
    git(tmpDir, "add", ".");
    git(tmpDir, "commit", "-m", "feat(auth): add login handler");

    writeFile(tmpDir, "src/api/routes.ts", 'export const routes = ["/login"];');
    git(tmpDir, "add", ".");
    git(tmpDir, "commit", "-m", "feat(api): add route definitions");

    // 2. Index the repo
    const layer = makeTestLayer(tmpDir);
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* initSchema;
        yield* rebuildIndex(tmpDir);
      }).pipe(Effect.provide(layer)),
    );

    // 3. Set up MCP server + client via InMemoryTransport
    const server = createServer({ repoDir: tmpDir, dbPath });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    client = new Client({ name: "test-client", version: "1.0.0" });
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    try {
      await client.close();
    } catch {}
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  test("kiste_list_tags returns tags including auth", async () => {
    const result = await client.callTool({
      name: "kiste_list_tags",
      arguments: {},
    });

    const parsed = JSON.parse((result.content as Array<{ text: string }>)[0].text);
    const tagNames = parsed.tags.map((t: { tag: string }) => t.tag);
    expect(tagNames).toContain("auth");
  });

  test("kiste_list_artifacts returns indexed files", async () => {
    const result = await client.callTool({
      name: "kiste_list_artifacts",
      arguments: {},
    });

    const parsed = JSON.parse((result.content as Array<{ text: string }>)[0].text);
    const paths = parsed.artifacts.map((a: { path: string }) => a.path);
    expect(paths).toContain("src/auth/login.ts");
    expect(paths).toContain("src/api/routes.ts");
  });

  test("kiste_get_artifact returns content, tags, and commits", async () => {
    const result = await client.callTool({
      name: "kiste_get_artifact",
      arguments: { path: "src/auth/login.ts" },
    });

    const parsed = JSON.parse((result.content as Array<{ text: string }>)[0].text);
    expect(parsed.path).toBe("src/auth/login.ts");
    expect(parsed.alive).toBe(true);
    expect(parsed.tags).toContain("auth");
    expect(parsed.content).toContain("authenticated");
    expect(parsed.commits.length).toBeGreaterThanOrEqual(1);
  });

  test("kiste_search finds commits by message", async () => {
    const result = await client.callTool({
      name: "kiste_search",
      arguments: { query: "login" },
    });

    const parsed = JSON.parse((result.content as Array<{ text: string }>)[0].text);
    expect(parsed.results.length).toBeGreaterThanOrEqual(1);
    const messages = parsed.results.map((r: { message: string }) => r.message);
    expect(messages.some((m: string) => m.includes("login"))).toBe(true);
  });

  test("kiste_get_provenance returns commit history", async () => {
    const result = await client.callTool({
      name: "kiste_get_provenance",
      arguments: { path: "src/auth/login.ts" },
    });

    const parsed = JSON.parse((result.content as Array<{ text: string }>)[0].text);
    expect(parsed.path).toBe("src/auth/login.ts");
    expect(parsed.commits.length).toBeGreaterThanOrEqual(1);
    expect(parsed.commits[0].message).toContain("login");
  });

  test("kiste_list_artifacts with tag filter", async () => {
    const result = await client.callTool({
      name: "kiste_list_artifacts",
      arguments: { tags: ["auth"] },
    });

    const parsed = JSON.parse((result.content as Array<{ text: string }>)[0].text);
    const paths = parsed.artifacts.map((a: { path: string }) => a.path);
    expect(paths).toContain("src/auth/login.ts");
    expect(paths).not.toContain("src/api/routes.ts");
  });

  test("kiste_get_artifact returns error for nonexistent path", async () => {
    const result = await client.callTool({
      name: "kiste_get_artifact",
      arguments: { path: "does/not/exist.ts" },
    });

    const parsed = JSON.parse((result.content as Array<{ text: string }>)[0].text);
    expect(parsed.error).toContain("not found");
  });

  test("kiste_search with tag filter", async () => {
    const result = await client.callTool({
      name: "kiste_search",
      arguments: { query: "login", tags: ["auth"] },
    });

    const parsed = JSON.parse((result.content as Array<{ text: string }>)[0].text);
    expect(parsed.results.length).toBeGreaterThanOrEqual(1);
  });

  test("kiste_list_artifacts excludes gitignored files by default", async () => {
    // Add a gitignored file to the repo (use build/ which is gitignored but not in default exclude list)
    writeFile(tmpDir, ".gitignore", "build/\n");
    writeFile(tmpDir, "build/output.js", "// built output");
    git(tmpDir, "add", "-f", "build/output.js", ".gitignore");
    git(tmpDir, "commit", "-m", "chore: add build output");

    // Recreate server with fresh DB connection to see reindexed data
    const dbPath = join(tmpDir, ".kiste", "index.sqlite");
    const layer = makeTestLayer(tmpDir);
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* initSchema;
        yield* rebuildIndex(tmpDir);
      }).pipe(Effect.provide(layer)),
    );

    await client.close();
    const server = createServer({ repoDir: tmpDir, dbPath });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    client = new Client({ name: "test-client", version: "1.0.0" });
    await client.connect(clientTransport);

    // Default: gitignored files excluded
    const result = await client.callTool({
      name: "kiste_list_artifacts",
      arguments: {},
    });
    const parsed = JSON.parse((result.content as Array<{ text: string }>)[0].text);
    const paths = parsed.artifacts.map((a: { path: string }) => a.path);
    expect(paths).not.toContain("build/output.js");
    expect(paths).toContain("src/auth/login.ts");

    // With include_ignored: true
    const result2 = await client.callTool({
      name: "kiste_list_artifacts",
      arguments: { include_ignored: true },
    });
    const parsed2 = JSON.parse((result2.content as Array<{ text: string }>)[0].text);
    const paths2 = parsed2.artifacts.map((a: { path: string }) => a.path);
    expect(paths2).toContain("build/output.js");
  });

  test("kiste_list_artifacts source_only filters to src/ paths", async () => {
    const result = await client.callTool({
      name: "kiste_list_artifacts",
      arguments: { source_only: true },
    });

    const parsed = JSON.parse((result.content as Array<{ text: string }>)[0].text);
    const paths = parsed.artifacts.map((a: { path: string }) => a.path);
    expect(paths.length).toBeGreaterThan(0);
    // All results should be under src/
    for (const p of paths) {
      expect(p.startsWith("src/") || p.includes("/src/")).toBe(true);
    }
    expect(paths).toContain("src/auth/login.ts");
  });
});
