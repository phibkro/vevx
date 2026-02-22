import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";

import { Effect, ManagedRuntime } from "effect";

import { CochangeDb, CochangeDbLive } from "./Cochange.js";

// ── Helpers ──

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

  // Insert test data: src/a.ts co-changes with src/b.ts (weight 5) and src/c.ts (weight 2)
  db.run("INSERT INTO artifacts (id, path) VALUES (1, 'src/a.ts')");
  db.run("INSERT INTO artifacts (id, path) VALUES (2, 'src/b.ts')");
  db.run("INSERT INTO artifacts (id, path) VALUES (3, 'src/c.ts')");

  // Multiple edges to test aggregation
  db.run("INSERT INTO co_change_edges (artifact_a, artifact_b, weight) VALUES (1, 2, 3.0)");
  db.run("INSERT INTO co_change_edges (artifact_a, artifact_b, weight) VALUES (1, 2, 2.0)");
  db.run("INSERT INTO co_change_edges (artifact_a, artifact_b, weight) VALUES (1, 3, 2.0)");

  db.close();
}

function withTempDb(fn: (dbPath: string) => Promise<void>): () => Promise<void> {
  return async () => {
    const tempDir = mkdtempSync(join(import.meta.dir, ".tmp-cochange-"));
    const dbPath = join(tempDir, "cochange.db");
    try {
      createFixtureDb(dbPath);
      await fn(dbPath);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  };
}

// ── Tests ──

describe("CochangeDb", () => {
  test(
    "returns neighbors ranked by coupling score",
    withTempDb(async (dbPath) => {
      const runtime = ManagedRuntime.make(CochangeDbLive(dbPath));
      try {
        const result = await runtime.runPromise(
          Effect.gen(function* () {
            const db = yield* CochangeDb;
            return yield* db.neighbors("src/a.ts");
          }),
        );

        expect(result).toEqual({
          path: "src/a.ts",
          neighbors: [
            { path: "src/b.ts", score: 5, commits: 2 },
            { path: "src/c.ts", score: 2, commits: 1 },
          ],
        });
      } finally {
        await runtime.dispose();
      }
    }),
  );

  test(
    "returns empty neighbors for unknown path",
    withTempDb(async (dbPath) => {
      const runtime = ManagedRuntime.make(CochangeDbLive(dbPath));
      try {
        const result = await runtime.runPromise(
          Effect.gen(function* () {
            const db = yield* CochangeDb;
            return yield* db.neighbors("src/unknown.ts");
          }),
        );

        expect(result).toEqual({
          path: "src/unknown.ts",
          neighbors: [],
        });
      } finally {
        await runtime.dispose();
      }
    }),
  );

  test("returns CochangeUnavailable when db is missing", async () => {
    const tempDir = mkdtempSync(join(import.meta.dir, ".tmp-cochange-"));
    const dbPath = join(tempDir, "nonexistent.db");

    const runtime = ManagedRuntime.make(CochangeDbLive(dbPath));
    try {
      const result = await runtime.runPromise(
        Effect.gen(function* () {
          const db = yield* CochangeDb;
          return yield* db.neighbors("src/a.ts");
        }),
      );

      expect(result).toEqual({
        error: "co_change_data_unavailable",
        message:
          "co-change data not found. run `varp coupling --build` to generate it, then retry.",
        path: dbPath,
      });
    } finally {
      await runtime.dispose();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
