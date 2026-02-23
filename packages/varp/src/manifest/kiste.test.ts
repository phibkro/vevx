import { Database } from "bun:sqlite";
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";

import type { Manifest } from "#shared/types.js";

import { readKisteCoChanges } from "./kiste.js";

const KISTE_SCHEMA = [
  `CREATE TABLE artifacts (
    id INTEGER PRIMARY KEY,
    path TEXT NOT NULL UNIQUE,
    alive INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE TABLE commits (
    sha TEXT PRIMARY KEY,
    message TEXT NOT NULL,
    author TEXT NOT NULL,
    timestamp INTEGER NOT NULL
  )`,
  `CREATE TABLE artifact_commits (
    artifact_id INTEGER REFERENCES artifacts(id),
    commit_sha TEXT REFERENCES commits(sha),
    PRIMARY KEY (artifact_id, commit_sha)
  )`,
  `CREATE INDEX idx_artifact_commits_sha ON artifact_commits(commit_sha)`,
];

const manifest: Manifest = {
  varp: "0.1.0",
  components: {
    auth: { path: "/project/src/auth", docs: [] },
    api: { path: "/project/src/api", docs: [] },
    web: { path: "/project/src/web", docs: [] },
  },
};

function seedDb(db: Database) {
  // 3 artifacts across 3 components
  db.run(`INSERT INTO artifacts (id, path, alive) VALUES (1, 'src/auth/login.ts', 1)`);
  db.run(`INSERT INTO artifacts (id, path, alive) VALUES (2, 'src/api/routes.ts', 1)`);
  db.run(`INSERT INTO artifacts (id, path, alive) VALUES (3, 'src/web/app.ts', 1)`);
  db.run(`INSERT INTO artifacts (id, path, alive) VALUES (4, 'src/auth/utils.ts', 1)`);

  // Commits
  db.run(`INSERT INTO commits VALUES ('aaa', 'feat: login', 'dev', 1000)`);
  db.run(`INSERT INTO commits VALUES ('bbb', 'fix: routes', 'dev', 2000)`);
  db.run(`INSERT INTO commits VALUES ('ccc', 'chore: both', 'dev', 3000)`);
  db.run(`INSERT INTO commits VALUES ('ddd', 'feat: web', 'dev', 4000)`);

  // aaa touches auth/login.ts + api/routes.ts
  db.run(`INSERT INTO artifact_commits VALUES (1, 'aaa')`);
  db.run(`INSERT INTO artifact_commits VALUES (2, 'aaa')`);

  // bbb touches api/routes.ts + auth/login.ts
  db.run(`INSERT INTO artifact_commits VALUES (2, 'bbb')`);
  db.run(`INSERT INTO artifact_commits VALUES (1, 'bbb')`);

  // ccc touches auth/login.ts + web/app.ts
  db.run(`INSERT INTO artifact_commits VALUES (1, 'ccc')`);
  db.run(`INSERT INTO artifact_commits VALUES (3, 'ccc')`);

  // ddd touches web/app.ts only
  db.run(`INSERT INTO artifact_commits VALUES (3, 'ddd')`);
}

describe("readKisteCoChanges", () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync("/tmp/claude/kiste-test-");
    dbPath = join(tmpDir, "index.sqlite");
    const db = new Database(dbPath);
    for (const sql of KISTE_SCHEMA) db.run(sql);
    seedDb(db);
    db.close();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("returns [] when DB does not exist", () => {
    const result = readKisteCoChanges(
      ["src/auth/login.ts"],
      manifest,
      join(tmpDir, "nonexistent.sqlite"),
    );
    expect(result).toEqual([]);
  });

  test("returns [] when file not found in DB", () => {
    const result = readKisteCoChanges(["src/unknown/file.ts"], manifest, dbPath);
    expect(result).toEqual([]);
  });

  test("maps co-changes to component deps with absolute paths", () => {
    // Use absolute paths matching manifest component paths
    const absManifest: Manifest = {
      varp: "0.1.0",
      components: {
        auth: { path: join(tmpDir, "src/auth"), docs: [] },
        api: { path: join(tmpDir, "src/api"), docs: [] },
        web: { path: join(tmpDir, "src/web"), docs: [] },
      },
    };

    // Re-seed with absolute paths
    const db = new Database(dbPath);
    db.run("DELETE FROM artifact_commits");
    db.run("DELETE FROM artifacts");
    db.run(
      `INSERT INTO artifacts (id, path, alive) VALUES (1, '${join(tmpDir, "src/auth/login.ts")}', 1)`,
    );
    db.run(
      `INSERT INTO artifacts (id, path, alive) VALUES (2, '${join(tmpDir, "src/api/routes.ts")}', 1)`,
    );
    db.run(
      `INSERT INTO artifacts (id, path, alive) VALUES (3, '${join(tmpDir, "src/web/app.ts")}', 1)`,
    );
    db.run(`INSERT INTO artifact_commits VALUES (1, 'aaa')`);
    db.run(`INSERT INTO artifact_commits VALUES (2, 'aaa')`);
    db.run(`INSERT INTO artifact_commits VALUES (1, 'bbb')`);
    db.run(`INSERT INTO artifact_commits VALUES (2, 'bbb')`);
    db.run(`INSERT INTO artifact_commits VALUES (1, 'ccc')`);
    db.run(`INSERT INTO artifact_commits VALUES (3, 'ccc')`);
    db.run(`INSERT INTO artifact_commits VALUES (3, 'ddd')`);
    db.close();

    const authFile = join(tmpDir, "src/auth/login.ts");
    const result = readKisteCoChanges([authFile], absManifest, dbPath, { minJaccard: 0 });

    const toComponents = result.map((d) => d.to).sort();
    expect(toComponents).toContain("api");
    expect(toComponents).toContain("web");

    // All deps should come from auth
    for (const dep of result) {
      expect(dep.from).toBe("auth");
    }

    // Evidence should contain cochange: prefix
    for (const dep of result) {
      for (const ev of dep.evidence) {
        expect(ev.import_specifier).toMatch(/^cochange:/);
      }
    }
  });

  test("filters by minJaccard", () => {
    const absManifest: Manifest = {
      varp: "0.1.0",
      components: {
        auth: { path: join(tmpDir, "src/auth"), docs: [] },
        api: { path: join(tmpDir, "src/api"), docs: [] },
        web: { path: join(tmpDir, "src/web"), docs: [] },
      },
    };

    const db = new Database(dbPath);
    db.run("DELETE FROM artifact_commits");
    db.run("DELETE FROM artifacts");
    db.run(
      `INSERT INTO artifacts (id, path, alive) VALUES (1, '${join(tmpDir, "src/auth/login.ts")}', 1)`,
    );
    db.run(
      `INSERT INTO artifacts (id, path, alive) VALUES (2, '${join(tmpDir, "src/api/routes.ts")}', 1)`,
    );
    db.run(
      `INSERT INTO artifacts (id, path, alive) VALUES (3, '${join(tmpDir, "src/web/app.ts")}', 1)`,
    );
    // auth/login.ts + api/routes.ts share 2 commits each having 2 total → jaccard = 2/2 = 1.0
    db.run(`INSERT INTO artifact_commits VALUES (1, 'aaa')`);
    db.run(`INSERT INTO artifact_commits VALUES (2, 'aaa')`);
    db.run(`INSERT INTO artifact_commits VALUES (1, 'bbb')`);
    db.run(`INSERT INTO artifact_commits VALUES (2, 'bbb')`);
    // auth/login.ts + web/app.ts share 1 commit, auth has 2, web has 2 → jaccard = 1/(2+2-1) = 0.33
    db.run(`INSERT INTO artifact_commits VALUES (1, 'ccc')`);
    db.run(`INSERT INTO artifact_commits VALUES (3, 'ccc')`);
    db.run(`INSERT INTO artifact_commits VALUES (3, 'ddd')`);
    db.close();

    const authFile = join(tmpDir, "src/auth/login.ts");

    // High threshold should filter out web (jaccard ~0.33)
    const highThreshold = readKisteCoChanges([authFile], absManifest, dbPath, { minJaccard: 0.5 });
    const highTo = highThreshold.map((d) => d.to);
    expect(highTo).toContain("api");
    expect(highTo).not.toContain("web");

    // Low threshold should include both
    const lowThreshold = readKisteCoChanges([authFile], absManifest, dbPath, { minJaccard: 0 });
    const lowTo = lowThreshold.map((d) => d.to);
    expect(lowTo).toContain("api");
    expect(lowTo).toContain("web");
  });

  test("skips co-changes within the same component", () => {
    const absManifest: Manifest = {
      varp: "0.1.0",
      components: {
        auth: { path: join(tmpDir, "src/auth"), docs: [] },
      },
    };

    const db = new Database(dbPath);
    db.run("DELETE FROM artifact_commits");
    db.run("DELETE FROM artifacts");
    db.run(
      `INSERT INTO artifacts (id, path, alive) VALUES (1, '${join(tmpDir, "src/auth/login.ts")}', 1)`,
    );
    db.run(
      `INSERT INTO artifacts (id, path, alive) VALUES (2, '${join(tmpDir, "src/auth/utils.ts")}', 1)`,
    );
    db.run(`INSERT INTO artifact_commits VALUES (1, 'aaa')`);
    db.run(`INSERT INTO artifact_commits VALUES (2, 'aaa')`);
    db.close();

    const result = readKisteCoChanges([join(tmpDir, "src/auth/login.ts")], absManifest, dbPath, {
      minJaccard: 0,
    });
    expect(result).toEqual([]);
  });
});
