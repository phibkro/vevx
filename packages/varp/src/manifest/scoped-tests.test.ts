import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import type { Manifest } from "#shared/types.js";

import { findScopedTests } from "./scoped-tests.js";

const TMP_DIR = join(import.meta.dir, "..", "..", "test-fixtures", "scoped-tests-tmp");

function makeDirs(...dirs: string[]) {
  for (const d of dirs) mkdirSync(d, { recursive: true });
}

function writeFile(path: string, content: string = "") {
  writeFileSync(path, content);
}

describe("findScopedTests", () => {
  let manifest: Manifest;

  beforeAll(() => {
    // Create directory structure:
    // scoped-tests-tmp/
    //   src/auth/auth.ts
    //   src/auth/auth.test.ts
    //   src/auth/utils/helpers.test.ts
    //   src/api/routes.ts
    //   src/api/routes.test.ts
    //   src/web/index.ts            (no test files)
    //   src/shared/shared.ts
    //   src/shared/shared.test.ts
    makeDirs(
      join(TMP_DIR, "src/auth/utils"),
      join(TMP_DIR, "src/api"),
      join(TMP_DIR, "src/web"),
      join(TMP_DIR, "src/shared"),
    );
    writeFile(join(TMP_DIR, "src/auth/auth.ts"), "export const auth = 1;");
    writeFile(join(TMP_DIR, "src/auth/auth.test.ts"), "test('auth', () => {});");
    writeFile(join(TMP_DIR, "src/auth/utils/helpers.test.ts"), "test('helpers', () => {});");
    writeFile(join(TMP_DIR, "src/api/routes.ts"), "export const routes = 1;");
    writeFile(join(TMP_DIR, "src/api/routes.test.ts"), "test('routes', () => {});");
    writeFile(join(TMP_DIR, "src/web/index.ts"), "export const web = 1;");
    writeFile(join(TMP_DIR, "src/shared/shared.ts"), "export const shared = 1;");
    writeFile(join(TMP_DIR, "src/shared/shared.test.ts"), "test('shared', () => {});");

    manifest = {
      varp: "0.1.0",
      components: {
        auth: { path: join(TMP_DIR, "src/auth"), docs: [] },
        api: { path: join(TMP_DIR, "src/api"), deps: ["auth"], docs: [] },
        web: { path: join(TMP_DIR, "src/web"), deps: ["api"], docs: [] },
        shared: { path: join(TMP_DIR, "src/shared"), docs: [] },
      },
    };
  });

  afterAll(() => {
    try {
      rmSync(TMP_DIR, { recursive: true });
    } catch {}
  });

  test("writes to a component returns its test files", () => {
    const result = findScopedTests(manifest, { writes: ["auth"] }, TMP_DIR);
    expect(result.test_files).toHaveLength(2);
    expect(result.test_files.some((f) => f.endsWith("auth.test.ts"))).toBe(true);
    expect(result.test_files.some((f) => f.endsWith("helpers.test.ts"))).toBe(true);
    expect(result.components_covered).toEqual(["auth"]);
    expect(result.run_command).toContain("bun test");
    expect(result.run_command).toContain("auth.test.ts");
  });

  test("reads only returns no tests by default", () => {
    const result = findScopedTests(manifest, { reads: ["auth"] }, TMP_DIR);
    expect(result.test_files).toEqual([]);
    expect(result.components_covered).toEqual([]);
    expect(result.run_command).toBe("");
  });

  test("include_read_tests returns tests for read components", () => {
    const result = findScopedTests(manifest, { reads: ["auth"] }, TMP_DIR, {
      includeReadTests: true,
    });
    expect(result.test_files).toHaveLength(2);
    expect(result.components_covered).toEqual(["auth"]);
    expect(result.run_command).toContain("bun test");
  });

  test("component with no test files returns empty", () => {
    const result = findScopedTests(manifest, { writes: ["web"] }, TMP_DIR);
    expect(result.test_files).toEqual([]);
    expect(result.components_covered).toEqual(["web"]);
    expect(result.run_command).toBe("");
  });

  test("multiple components aggregates test files", () => {
    const result = findScopedTests(manifest, { writes: ["auth", "api"] }, TMP_DIR);
    expect(result.test_files).toHaveLength(3); // 2 auth + 1 api
    expect(result.components_covered).toEqual(["api", "auth"]);
    expect(result.run_command).toContain("bun test");
  });

  test("writes + reads with include_read_tests combines both", () => {
    const result = findScopedTests(manifest, { writes: ["api"], reads: ["shared"] }, TMP_DIR, {
      includeReadTests: true,
    });
    expect(result.test_files).toHaveLength(2); // 1 api + 1 shared
    expect(result.components_covered).toEqual(["api", "shared"]);
  });

  test("unknown component names are skipped", () => {
    const result = findScopedTests(manifest, { writes: ["nonexistent"] }, TMP_DIR);
    expect(result.test_files).toEqual([]);
    expect(result.components_covered).toEqual([]);
    expect(result.run_command).toBe("");
  });

  test("run_command uses relative paths", () => {
    const result = findScopedTests(manifest, { writes: ["api"] }, TMP_DIR);
    expect(result.run_command).not.toContain(TMP_DIR);
    expect(result.run_command).toContain("src/api/routes.test.ts");
  });

  test("deduplicates when component appears in both reads and writes", () => {
    const result = findScopedTests(manifest, { writes: ["auth"], reads: ["auth"] }, TMP_DIR, {
      includeReadTests: true,
    });
    expect(result.test_files).toHaveLength(2); // no duplicates
    expect(result.components_covered).toEqual(["auth"]);
  });

  test("returns empty custom_commands when no test fields", () => {
    const result = findScopedTests(manifest, { writes: ["auth"] }, TMP_DIR);
    expect(result.custom_commands).toEqual([]);
  });

  test("returns empty required_env when components have no env", () => {
    const result = findScopedTests(manifest, { writes: ["auth"] }, TMP_DIR);
    expect(result.required_env).toEqual([]);
  });

  test("collects required_env from covered components", () => {
    const manifestWithEnv: Manifest = {
      varp: "0.1.0",
      components: {
        auth: { path: join(TMP_DIR, "src/auth"), env: ["JWT_SECRET"], docs: [] },
        api: { path: join(TMP_DIR, "src/api"), env: ["DATABASE_URL", "REDIS_URL"], docs: [] },
      },
    };

    const result = findScopedTests(manifestWithEnv, { writes: ["auth", "api"] }, TMP_DIR);
    expect(result.required_env).toEqual(["DATABASE_URL", "JWT_SECRET", "REDIS_URL"]);
  });

  test("deduplicates required_env across components", () => {
    const manifestWithEnv: Manifest = {
      varp: "0.1.0",
      components: {
        auth: { path: join(TMP_DIR, "src/auth"), env: ["SHARED_VAR"], docs: [] },
        api: { path: join(TMP_DIR, "src/api"), env: ["SHARED_VAR", "OTHER_VAR"], docs: [] },
      },
    };

    const result = findScopedTests(manifestWithEnv, { writes: ["auth", "api"] }, TMP_DIR);
    expect(result.required_env).toEqual(["OTHER_VAR", "SHARED_VAR"]);
  });

  test("component with test field uses custom command", () => {
    const manifestWithTest: Manifest = {
      varp: "0.1.0",
      components: {
        auth: { path: join(TMP_DIR, "src/auth"), docs: [] },
        api: { path: join(TMP_DIR, "src/api"), test: "npm test -- --filter api", docs: [] },
      },
    };

    const result = findScopedTests(manifestWithTest, { writes: ["api"] }, TMP_DIR);
    expect(result.custom_commands).toEqual(["npm test -- --filter api"]);
    expect(result.test_files).toEqual([]); // skips file discovery
    expect(result.components_covered).toEqual(["api"]);
    expect(result.run_command).toBe("npm test -- --filter api");
  });

  test("mixed custom and discovered tests combines in run_command", () => {
    const manifestWithTest: Manifest = {
      varp: "0.1.0",
      components: {
        auth: { path: join(TMP_DIR, "src/auth"), docs: [] },
        api: { path: join(TMP_DIR, "src/api"), test: "npm test -- --filter api", docs: [] },
      },
    };

    const result = findScopedTests(manifestWithTest, { writes: ["auth", "api"] }, TMP_DIR);
    expect(result.test_files).toHaveLength(2); // auth's discovered tests
    expect(result.custom_commands).toEqual(["npm test -- --filter api"]);
    expect(result.run_command).toContain("bun test");
    expect(result.run_command).toContain(" && ");
    expect(result.run_command).toContain("npm test -- --filter api");
  });

  test("tag filter includes matching components", () => {
    const manifestWithTags: Manifest = {
      varp: "0.1.0",
      components: {
        auth: { path: join(TMP_DIR, "src/auth"), tags: ["security"], docs: [] },
        api: { path: join(TMP_DIR, "src/api"), tags: ["backend"], docs: [] },
      },
    };

    const result = findScopedTests(manifestWithTags, { writes: ["auth", "api"] }, TMP_DIR, {
      tags: ["security"],
    });
    expect(result.components_covered).toEqual(["auth"]);
    expect(result.test_files).toHaveLength(2); // auth's test files
  });

  test("tag filter excludes non-matching components", () => {
    const manifestWithTags: Manifest = {
      varp: "0.1.0",
      components: {
        auth: { path: join(TMP_DIR, "src/auth"), tags: ["security"], docs: [] },
        api: { path: join(TMP_DIR, "src/api"), tags: ["backend"], docs: [] },
      },
    };

    const result = findScopedTests(manifestWithTags, { writes: ["auth", "api"] }, TMP_DIR, {
      tags: ["frontend"],
    });
    expect(result.components_covered).toEqual([]);
    expect(result.test_files).toEqual([]);
  });

  test("empty tags array means no filter", () => {
    const manifestWithTags: Manifest = {
      varp: "0.1.0",
      components: {
        auth: { path: join(TMP_DIR, "src/auth"), tags: ["security"], docs: [] },
        api: { path: join(TMP_DIR, "src/api"), tags: ["backend"], docs: [] },
      },
    };

    const result = findScopedTests(manifestWithTags, { writes: ["auth", "api"] }, TMP_DIR, {
      tags: [],
    });
    expect(result.components_covered).toEqual(["api", "auth"]);
  });

  test("tag filter works with components that have no tags", () => {
    const manifestMixed: Manifest = {
      varp: "0.1.0",
      components: {
        auth: { path: join(TMP_DIR, "src/auth"), tags: ["security"], docs: [] },
        api: { path: join(TMP_DIR, "src/api"), docs: [] }, // no tags
      },
    };

    const result = findScopedTests(manifestMixed, { writes: ["auth", "api"] }, TMP_DIR, {
      tags: ["security"],
    });
    expect(result.components_covered).toEqual(["auth"]);
  });
});
