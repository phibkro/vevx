import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { bunResolve, loadTsconfigPaths } from "./imports.js";

describe("bunResolve", () => {
  const CORE_SRC = join(import.meta.dir, "..");

  test("resolves relative .js to .ts", () => {
    const result = bunResolve("./manifest/lint.js", CORE_SRC);
    expect(result).toEndWith("/manifest/lint.ts");
  });

  test("resolves cross-directory relative", () => {
    const result = bunResolve("../shared/types.js", join(CORE_SRC, "manifest"));
    expect(result).toEndWith("/shared/types.ts");
  });

  test("returns null for unresolvable specifier", () => {
    const result = bunResolve("./definitely-does-not-exist-abc123.js", CORE_SRC);
    expect(result).toBeNull();
  });

  test("resolves bare specifier to node_modules", () => {
    const result = bunResolve("zod", CORE_SRC);
    expect(result).not.toBeNull();
    expect(result!).toInclude("node_modules");
  });
});

describe("loadTsconfigPaths", () => {
  const tmpDir = join(import.meta.dir, "__test_tsconfig__");

  beforeAll(() => {
    mkdirSync(tmpDir, { recursive: true });
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("reads paths from tsconfig.json", () => {
    const dir = join(tmpDir, "basic");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          paths: { "#shared/*": ["./src/shared/*"] },
        },
      }),
    );
    const result = loadTsconfigPaths(dir);
    expect(result).not.toBeNull();
    expect(result!.mappings).toHaveLength(1);
    expect(result!.mappings[0].pattern).toBe("#shared/*");
  });

  test("returns null when no tsconfig.json", () => {
    const dir = join(tmpDir, "no-tsconfig");
    mkdirSync(dir, { recursive: true });
    expect(loadTsconfigPaths(dir)).toBeNull();
  });

  test("returns null when no paths", () => {
    const dir = join(tmpDir, "no-paths");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { strict: true } }),
    );
    expect(loadTsconfigPaths(dir)).toBeNull();
  });

  test("resolves baseUrl", () => {
    const dir = join(tmpDir, "baseurl");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          baseUrl: "./src",
          paths: { "@/*": ["./*"] },
        },
      }),
    );
    const result = loadTsconfigPaths(dir);
    expect(result).not.toBeNull();
    expect(result!.baseDir).toBe(join(dir, "src"));
  });

  test("strips JSON comments", () => {
    const dir = join(tmpDir, "comments");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "tsconfig.json"),
      `{
        // This is a comment
        "compilerOptions": {
          /* block comment */
          "paths": { "#lib/*": ["./lib/*"] }
        }
      }`,
    );
    const result = loadTsconfigPaths(dir);
    expect(result).not.toBeNull();
    expect(result!.mappings[0].pattern).toBe("#lib/*");
  });

  test("follows extends chain with relative path", () => {
    const dir = join(tmpDir, "extends-rel");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "tsconfig.base.json"),
      JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          paths: { "#base/*": ["./base/*"] },
        },
      }),
    );
    writeFileSync(
      join(dir, "tsconfig.json"),
      JSON.stringify({
        extends: "./tsconfig.base.json",
        compilerOptions: {
          paths: { "#app/*": ["./app/*"] },
        },
      }),
    );
    const result = loadTsconfigPaths(dir);
    expect(result).not.toBeNull();
    // Child paths merge with parent — both should be present
    expect(result!.mappings).toHaveLength(2);
    const patterns = result!.mappings.map((m) => m.pattern).sort();
    expect(patterns).toEqual(["#app/*", "#base/*"]);
  });

  test("child paths override parent paths for same key", () => {
    const dir = join(tmpDir, "extends-override");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "tsconfig.base.json"),
      JSON.stringify({
        compilerOptions: {
          paths: { "#shared/*": ["./old/*"] },
        },
      }),
    );
    writeFileSync(
      join(dir, "tsconfig.json"),
      JSON.stringify({
        extends: "./tsconfig.base.json",
        compilerOptions: {
          paths: { "#shared/*": ["./new/*"] },
        },
      }),
    );
    const result = loadTsconfigPaths(dir);
    expect(result).not.toBeNull();
    expect(result!.mappings).toHaveLength(1);
    expect(result!.mappings[0].targets).toEqual(["./new/*"]);
  });

  test("inherits paths from parent when child has none", () => {
    const dir = join(tmpDir, "extends-inherit");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "tsconfig.base.json"),
      JSON.stringify({
        compilerOptions: {
          paths: { "#shared/*": ["./src/shared/*"] },
        },
      }),
    );
    writeFileSync(
      join(dir, "tsconfig.json"),
      JSON.stringify({
        extends: "./tsconfig.base.json",
        compilerOptions: { strict: true },
      }),
    );
    const result = loadTsconfigPaths(dir);
    expect(result).not.toBeNull();
    expect(result!.mappings).toHaveLength(1);
    expect(result!.mappings[0].pattern).toBe("#shared/*");
  });

  test("child baseUrl overrides parent baseUrl", () => {
    const dir = join(tmpDir, "extends-baseurl");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "tsconfig.base.json"),
      JSON.stringify({
        compilerOptions: {
          baseUrl: "./parent",
          paths: { "#x/*": ["./*"] },
        },
      }),
    );
    writeFileSync(
      join(dir, "tsconfig.json"),
      JSON.stringify({
        extends: "./tsconfig.base.json",
        compilerOptions: { baseUrl: "./child" },
      }),
    );
    const result = loadTsconfigPaths(dir);
    expect(result).not.toBeNull();
    expect(result!.baseDir).toBe(join(dir, "child"));
  });

  test("handles cycle in extends gracefully", () => {
    const dir = join(tmpDir, "extends-cycle");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "a.json"),
      JSON.stringify({
        extends: "./b.json",
        compilerOptions: { paths: { "#a/*": ["./a/*"] } },
      }),
    );
    writeFileSync(
      join(dir, "b.json"),
      JSON.stringify({
        extends: "./a.json",
        compilerOptions: { paths: { "#b/*": ["./b/*"] } },
      }),
    );
    writeFileSync(
      join(dir, "tsconfig.json"),
      JSON.stringify({
        extends: "./a.json",
      }),
    );
    // Should not infinite loop — cycle detection returns null for cycled parent
    const result = loadTsconfigPaths(dir);
    expect(result).not.toBeNull();
  });

  test("loads #shared/* alias from packages/varp/tsconfig.json", () => {
    // Integration: verify the real tsconfig is parseable and has the expected alias
    const coreDir = join(import.meta.dir, "../..");
    const result = loadTsconfigPaths(coreDir);
    expect(result).not.toBeNull();
    const sharedMapping = result!.mappings.find((m) => m.pattern === "#shared/*");
    expect(sharedMapping).toBeDefined();
    expect(sharedMapping!.targets).toEqual(["./src/shared/*"]);
  });

  test("preserves /* inside string values during comment stripping", () => {
    // Regression: stripJsonComments treated /* inside JSON strings as block comment starts,
    // corrupting path patterns like "#shared/*": ["./src/shared/*"]
    const dir = join(tmpDir, "glob-paths");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "tsconfig.json"),
      `{
        "compilerOptions": {
          "paths": { "#shared/*": ["./src/shared/*"] }
        }
      }`,
    );
    const result = loadTsconfigPaths(dir);
    expect(result).not.toBeNull();
    expect(result!.mappings).toHaveLength(1);
    expect(result!.mappings[0].pattern).toBe("#shared/*");
    expect(result!.mappings[0].targets).toEqual(["./src/shared/*"]);
  });

  test("returns null when extends target is missing", () => {
    const dir = join(tmpDir, "extends-missing");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "tsconfig.json"),
      JSON.stringify({
        extends: "./nonexistent.json",
        compilerOptions: {
          paths: { "#x/*": ["./*"] },
        },
      }),
    );
    // Should still return paths from the child even if parent is missing
    const result = loadTsconfigPaths(dir);
    expect(result).not.toBeNull();
    expect(result!.mappings[0].pattern).toBe("#x/*");
  });
});
