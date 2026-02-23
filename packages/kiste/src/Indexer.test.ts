import { describe, expect, test, afterEach } from "bun:test";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  readdirSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";

import { SqliteClient } from "@effect/sql-sqlite-bun";
import * as SqlClient from "@effect/sql/SqlClient";
import { Effect, Layer } from "effect";
import * as Schema from "effect/Schema";

import { Config, ConfigSchema } from "./Config.js";
import { initSchema } from "./Db.js";
import { GitLive } from "./Git.js";
import { rebuildIndex, incrementalIndex, createSnapshot, restoreSnapshot } from "./Indexer.js";

function git(cwd: string, ...args: string[]) {
  const result = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (!result.success) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString()}`);
  return result.stdout.toString().trim();
}

function makeTempDir(): string {
  return mkdtempSync("/tmp/claude/kiste-test-");
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

function makeLayer(cwd: string, configOverrides: Record<string, unknown> = {}) {
  const dbPath = join(cwd, ".kiste", "index.sqlite");
  Bun.spawnSync(["mkdir", "-p", join(cwd, ".kiste")], { cwd });
  return Layer.mergeAll(
    Layer.succeed(Config, Schema.decodeUnknownSync(ConfigSchema)(configOverrides)),
    SqliteClient.layer({ filename: dbPath }),
    GitLive,
  );
}

const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {}
  }
  dirs.length = 0;
});

describe("Indexer", () => {
  test("indexes a single commit", async () => {
    const cwd = makeTempDir();
    dirs.push(cwd);
    initRepo(cwd);
    writeFile(cwd, "hello.txt", "hello");
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "feat: initial commit");

    const layer = makeLayer(cwd);

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* initSchema;
        const result = yield* rebuildIndex(cwd);
        expect(result.commits_indexed).toBe(1);
        expect(result.artifacts_indexed).toBeGreaterThanOrEqual(1);

        // Verify artifact exists in DB
        const sql = yield* SqlClient.SqlClient;
        const rows = yield* sql<{
          path: string;
          alive: number;
        }>`SELECT path, alive FROM artifacts WHERE path = ${"hello.txt"}`;
        expect(rows.length).toBe(1);
        expect(rows[0].alive).toBe(1);
      }).pipe(Effect.provide(layer)),
    );
  });

  test("tracks file deletion", async () => {
    const cwd = makeTempDir();
    dirs.push(cwd);
    initRepo(cwd);
    writeFile(cwd, "doomed.txt", "doomed");
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "feat: add file");
    Bun.spawnSync(["rm", "doomed.txt"], { cwd });
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "chore: remove file");

    const layer = makeLayer(cwd);

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* initSchema;
        const result = yield* rebuildIndex(cwd);
        expect(result.commits_indexed).toBe(2);

        const sql = yield* SqlClient.SqlClient;
        const rows = yield* sql<{
          alive: number;
        }>`SELECT alive FROM artifacts WHERE path = ${"doomed.txt"}`;
        expect(rows.length).toBe(1);
        expect(rows[0].alive).toBe(0);
      }).pipe(Effect.provide(layer)),
    );
  });

  test("incremental index skips already-indexed commits", async () => {
    const cwd = makeTempDir();
    dirs.push(cwd);
    initRepo(cwd);
    writeFile(cwd, "a.txt", "a");
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "feat: first");

    const layer = makeLayer(cwd);

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* initSchema;

        const r1 = yield* incrementalIndex(cwd);
        expect(r1.commits_indexed).toBe(1);

        const r2 = yield* incrementalIndex(cwd);
        expect(r2.commits_indexed).toBe(0);
      }).pipe(Effect.provide(layer)),
    );

    // New commit in a separate effect run to pick up the new git state
    writeFile(cwd, "b.txt", "b");
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "feat: second");

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* initSchema;
        const r3 = yield* incrementalIndex(cwd);
        expect(r3.commits_indexed).toBe(1);
      }).pipe(Effect.provide(layer)),
    );
  });

  test("processes tag operations from commit body", async () => {
    const cwd = makeTempDir();
    dirs.push(cwd);
    initRepo(cwd);
    writeFile(cwd, "src/core/utils.ts", "export const noop = () => {}");
    git(cwd, "add", ".");
    // Commit with a tags: line in the body to trigger insertTagOps
    git(cwd, "commit", "-m", "feat: add utils", "-m", "tags: +security, +critical");

    const layer = makeLayer(cwd);

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* initSchema;
        const result = yield* rebuildIndex(cwd);
        expect(result.commits_indexed).toBe(1);

        const sql = yield* SqlClient.SqlClient;
        const tags = yield* sql<{ tag: string }>`
          SELECT at.tag FROM artifact_tags at
          JOIN artifacts a ON a.id = at.artifact_id
          WHERE a.path = ${"src/core/utils.ts"}
        `;
        const tagNames = tags.map((r) => r.tag);
        // Should have folder-derived tags plus explicit tags
        expect(tagNames).toContain("security");
        expect(tagNames).toContain("critical");
      }).pipe(Effect.provide(layer)),
    );
  });

  test("handles file rename across commits", async () => {
    const cwd = makeTempDir();
    dirs.push(cwd);
    initRepo(cwd);
    writeFile(cwd, "old-name.ts", "export const x = 1");
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "feat: add file");
    git(cwd, "mv", "old-name.ts", "new-name.ts");
    git(cwd, "commit", "-m", "refactor: rename file");

    const layer = makeLayer(cwd);

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* initSchema;
        const result = yield* rebuildIndex(cwd);
        expect(result.commits_indexed).toBe(2);

        const sql = yield* SqlClient.SqlClient;
        // Old path should be marked dead
        const old = yield* sql<{
          alive: number;
        }>`SELECT alive FROM artifacts WHERE path = ${"old-name.ts"}`;
        expect(old.length).toBe(1);
        expect(old[0].alive).toBe(0);

        // New path should be alive
        const renamed = yield* sql<{
          alive: number;
        }>`SELECT alive FROM artifacts WHERE path = ${"new-name.ts"}`;
        expect(renamed.length).toBe(1);
        expect(renamed[0].alive).toBe(1);
      }).pipe(Effect.provide(layer)),
    );
  });

  test("excludes files matching exclude globs", async () => {
    const cwd = makeTempDir();
    dirs.push(cwd);
    initRepo(cwd);
    writeFile(cwd, "src/app.ts", "export const app = 1");
    writeFile(cwd, "node_modules/foo/index.js", "module.exports = {}");
    writeFile(cwd, "dist/bundle.js", "// bundled");
    writeFile(cwd, "bun.lock", "lockfile content");
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "feat: initial with excluded files");

    const layer = makeLayer(cwd);

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* initSchema;
        yield* rebuildIndex(cwd);

        const sql = yield* SqlClient.SqlClient;
        const rows = yield* sql<{ path: string }>`SELECT path FROM artifacts`;
        const paths = rows.map((r) => r.path);

        expect(paths).toContain("src/app.ts");
        expect(paths).not.toContain("node_modules/foo/index.js");
        expect(paths).not.toContain("dist/bundle.js");
        expect(paths).not.toContain("bun.lock");
      }).pipe(Effect.provide(layer)),
    );
  });

  test("custom exclude patterns override defaults", async () => {
    const cwd = makeTempDir();
    dirs.push(cwd);
    initRepo(cwd);
    writeFile(cwd, "src/app.ts", "export const app = 1");
    writeFile(cwd, "generated/types.ts", "export type Foo = string");
    writeFile(cwd, "node_modules/foo/index.js", "module.exports = {}");
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "feat: with custom excludes");

    // Custom exclude replaces defaults — node_modules is no longer excluded
    const layer = makeLayer(cwd, { exclude: ["generated/**"] });

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* initSchema;
        yield* rebuildIndex(cwd);

        const sql = yield* SqlClient.SqlClient;
        const rows = yield* sql<{ path: string }>`SELECT path FROM artifacts`;
        const paths = rows.map((r) => r.path);

        expect(paths).toContain("src/app.ts");
        expect(paths).toContain("node_modules/foo/index.js");
        expect(paths).not.toContain("generated/types.ts");
      }).pipe(Effect.provide(layer)),
    );
  });

  test("derives folder tags from paths", async () => {
    const cwd = makeTempDir();
    dirs.push(cwd);
    initRepo(cwd);
    writeFile(cwd, "src/auth/login.ts", "export const login = () => {}");
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "feat(auth): add login");

    const layer = makeLayer(cwd);

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* initSchema;
        const result = yield* rebuildIndex(cwd);
        expect(result.commits_indexed).toBe(1);

        const sql = yield* SqlClient.SqlClient;
        const tags = yield* sql<{ tag: string }>`
          SELECT at.tag FROM artifact_tags at
          JOIN artifacts a ON a.id = at.artifact_id
          WHERE a.path = ${"src/auth/login.ts"}
        `;
        const tagNames = tags.map((r) => r.tag);
        expect(tagNames).toContain("auth");
      }).pipe(Effect.provide(layer)),
    );
  });
});

describe("Snapshots", () => {
  test("createSnapshot produces a valid sqlite copy", async () => {
    const cwd = makeTempDir();
    dirs.push(cwd);
    initRepo(cwd);
    writeFile(cwd, "src/a.ts", "export const a = 1;");
    writeFile(cwd, "src/b.ts", "export const b = 2;");
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "feat: add files");

    const layer = makeLayer(cwd);

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* initSchema;
        yield* rebuildIndex(cwd);

        const snap = yield* createSnapshot(cwd);
        expect(snap.sha).toBeTruthy();
        expect(snap.artifact_count).toBe(2);
        expect(existsSync(join(cwd, snap.path))).toBe(true);
      }).pipe(Effect.provide(layer)),
    );
  });

  test("restoreSnapshot + incrementalIndex produces same result as full reindex", async () => {
    const cwd = makeTempDir();
    dirs.push(cwd);
    initRepo(cwd);

    // Create 3 commits
    for (let i = 1; i <= 3; i++) {
      writeFile(cwd, `src/file${i}.ts`, `export const f${i} = ${i};`);
      git(cwd, "add", ".");
      git(cwd, "commit", "-m", `feat: add file${i}`);
    }

    const layer = makeLayer(cwd);

    // Index 3 commits and snapshot
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* initSchema;
        yield* rebuildIndex(cwd);
        yield* createSnapshot(cwd);
      }).pipe(Effect.provide(layer)),
    );

    // Add 2 more commits
    for (let i = 4; i <= 5; i++) {
      writeFile(cwd, `src/file${i}.ts`, `export const f${i} = ${i};`);
      git(cwd, "add", ".");
      git(cwd, "commit", "-m", `feat: add file${i}`);
    }

    // Full reindex for comparison
    const fullLayer = makeLayer(cwd, { db_path: ".kiste/full-reindex.sqlite" });
    const fullCount = await Effect.runPromise(
      Effect.gen(function* () {
        yield* initSchema;
        yield* rebuildIndex(cwd);
        const sql = yield* SqlClient.SqlClient;
        const rows = (yield* sql.unsafe(
          `SELECT COUNT(*) as count FROM artifacts WHERE alive = 1`,
        )) as unknown as { count: number }[];
        return rows[0].count;
      }).pipe(Effect.provide(fullLayer)),
    );

    // Delete index, restore snapshot (only needs Config, not SqlClient)
    const dbPath = join(cwd, ".kiste", "index.sqlite");
    unlinkSync(dbPath);

    const configLayer = Layer.succeed(Config, Schema.decodeUnknownSync(ConfigSchema)({}));
    const restored = await Effect.runPromise(
      restoreSnapshot(cwd).pipe(Effect.provide(configLayer)),
    );
    expect(restored.sha).toBeTruthy();

    // Fresh layer to pick up the restored DB for incremental indexing
    const incrementalLayer = makeLayer(cwd);
    const restoredCount = await Effect.runPromise(
      Effect.gen(function* () {
        yield* initSchema;
        yield* incrementalIndex(cwd);

        const sql = yield* SqlClient.SqlClient;
        const rows = (yield* sql.unsafe(
          `SELECT COUNT(*) as count FROM artifacts WHERE alive = 1`,
        )) as unknown as { count: number }[];
        return rows[0].count;
      }).pipe(Effect.provide(incrementalLayer)),
    );

    // Key invariant: restore + incremental == full reindex
    expect(restoredCount).toBe(fullCount);
  });

  test("auto-snapshot triggers at configured frequency", async () => {
    const cwd = makeTempDir();
    dirs.push(cwd);
    initRepo(cwd);

    // Create 3 commits
    for (let i = 1; i <= 3; i++) {
      writeFile(cwd, `src/file${i}.ts`, `export const f${i} = ${i};`);
      git(cwd, "add", ".");
      git(cwd, "commit", "-m", `feat: add file${i}`);
    }

    // Set snapshot_frequency to 2 — should auto-snapshot after indexing 3 commits
    const layer = makeLayer(cwd, { snapshot_frequency: 2 });

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* initSchema;
        yield* rebuildIndex(cwd);

        // Verify snapshot was auto-created
        const snapshotsDir = join(cwd, ".kiste", "snapshots");
        expect(existsSync(snapshotsDir)).toBe(true);
        const files = readdirSync(snapshotsDir).filter((f) => f.endsWith(".sqlite"));
        expect(files.length).toBe(1);
      }).pipe(Effect.provide(layer)),
    );
  });
});
