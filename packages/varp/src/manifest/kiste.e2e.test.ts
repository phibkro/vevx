import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import type { Manifest } from "#shared/types.js";

import { readKisteCoChanges } from "./kiste.js";

// Kiste CLI binary — built by turbo build
const KISTE_CLI = resolve(import.meta.dir, "../../../../packages/kiste/dist/Cli.js");

function git(cwd: string, ...args: string[]) {
  const r = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (!r.success) throw new Error(`git ${args.join(" ")} failed: ${r.stderr.toString()}`);
  return r.stdout.toString().trim();
}

// Skip under turbo (subprocess sandbox) or when kiste CLI isn't built
describe.skipIf(!!process.env.TURBO_HASH || !existsSync(KISTE_CLI))(
  "readKisteCoChanges e2e (real kiste index)",
  () => {
    let tmpDir: string;
    let dbPath: string;

    beforeAll(() => {
      tmpDir = mkdtempSync("/tmp/claude/kiste-e2e-");

      git(tmpDir, "init");
      git(tmpDir, "config", "user.email", "test@test.com");
      git(tmpDir, "config", "user.name", "Test");

      // Commit 1: auth + api co-change
      mkdirSync(join(tmpDir, "src/auth"), { recursive: true });
      mkdirSync(join(tmpDir, "src/api"), { recursive: true });
      writeFileSync(join(tmpDir, "src/auth/login.ts"), "export const login = () => {};");
      writeFileSync(join(tmpDir, "src/api/routes.ts"), "export const routes = [];");
      git(tmpDir, "add", ".");
      git(tmpDir, "commit", "-m", "feat: auth + api");

      // Commit 2: same files again (strengthens co-change)
      writeFileSync(join(tmpDir, "src/auth/login.ts"), "export const login = (u: string) => {};");
      writeFileSync(join(tmpDir, "src/api/routes.ts"), 'export const routes = ["/"];');
      git(tmpDir, "add", ".");
      git(tmpDir, "commit", "-m", "fix: update auth + api");

      // Commit 3: auth only (dilutes jaccard with api, adds asymmetry)
      writeFileSync(join(tmpDir, "src/auth/login.ts"), 'export const login = (u: string) => "ok";');
      git(tmpDir, "add", ".");
      git(tmpDir, "commit", "-m", "fix(auth): harden login");

      // Create .kiste directory for the DB
      mkdirSync(join(tmpDir, ".kiste"), { recursive: true });

      // Run kiste indexer via CLI subprocess
      const result = Bun.spawnSync(["bun", "run", KISTE_CLI, "index", "--rebuild"], {
        cwd: tmpDir,
        stdout: "pipe",
        stderr: "pipe",
      });
      if (!result.success) {
        throw new Error(
          `kiste index failed (exit ${result.exitCode}): stdout=${result.stdout.toString()} stderr=${result.stderr.toString()}`,
        );
      }

      dbPath = join(tmpDir, ".kiste", "index.sqlite");
    });

    afterAll(() => {
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {}
    });

    test("finds cross-component co-change from real kiste index", () => {
      // Kiste stores relative paths. Manifest paths must use the same prefix
      // so findOwningComponent's startsWith check matches.
      const manifest: Manifest = {
        varp: "0.1.0",
        components: {
          auth: { path: "src/auth", docs: [] },
          api: { path: "src/api", docs: [] },
        },
      };

      const deps = readKisteCoChanges(["src/auth/login.ts"], manifest, dbPath, { minJaccard: 0 });

      expect(deps.length).toBeGreaterThan(0);
      // auth -> api co-change should be detected
      const apiDep = deps.find((d) => d.to === "api");
      expect(apiDep).toBeDefined();
      expect(apiDep!.from).toBe("auth");
      expect(apiDep!.evidence[0].import_specifier).toMatch(/^cochange:/);
    });

    test("returns empty when file has no co-changes", () => {
      const manifest: Manifest = {
        varp: "0.1.0",
        components: {
          auth: { path: "src/auth", docs: [] },
          api: { path: "src/api", docs: [] },
        },
      };

      const deps = readKisteCoChanges(["src/nonexistent.ts"], manifest, dbPath);
      expect(deps).toEqual([]);
    });
  },
);
