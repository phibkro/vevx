import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { loadTsconfigPaths, resolveAlias, type PathAliases } from "./Resolve.js";

mkdirSync("/tmp/claude", { recursive: true });

describe("loadTsconfigPaths", () => {
  test("returns null when tsconfig.json missing", () => {
    const result = loadTsconfigPaths("/tmp/claude/nonexistent-dir-xyz");
    expect(result).toBeNull();
  });

  test("returns null when tsconfig has no paths", () => {
    const dir = mkdtempSync(join("/tmp/claude/", "resolve-"));
    try {
      writeFileSync(
        join(dir, "tsconfig.json"),
        JSON.stringify({ compilerOptions: { target: "ES2022" } }),
      );
      const result = loadTsconfigPaths(dir);
      expect(result).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("loads wildcard path mappings", () => {
    const dir = mkdtempSync(join("/tmp/claude/", "resolve-"));
    try {
      writeFileSync(
        join(dir, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: { paths: { "#shared/*": ["./src/shared/*"] } },
        }),
      );
      const result = loadTsconfigPaths(dir);
      expect(result).not.toBeNull();
      expect(result!.mappings).toHaveLength(1);
      expect(result!.mappings[0].pattern).toBe("#shared/*");
      expect(result!.baseDir).toBe(resolve(dir));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("follows extends chain", () => {
    const dir = mkdtempSync(join("/tmp/claude/", "resolve-"));
    try {
      writeFileSync(
        join(dir, "tsconfig.base.json"),
        JSON.stringify({
          compilerOptions: { paths: { "@app/*": ["./app/*"] } },
        }),
      );
      writeFileSync(
        join(dir, "tsconfig.json"),
        JSON.stringify({ extends: "./tsconfig.base.json" }),
      );
      const result = loadTsconfigPaths(dir);
      expect(result).not.toBeNull();
      expect(result!.mappings).toHaveLength(1);
      expect(result!.mappings[0].pattern).toBe("@app/*");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("resolveAlias", () => {
  const aliases: PathAliases = {
    mappings: [
      { pattern: "#shared/*", targets: ["./src/shared/*"] },
      { pattern: "#config", targets: ["./src/config.ts"] },
    ],
    baseDir: "/project",
  };

  test("resolves wildcard alias", () => {
    const result = resolveAlias("#shared/types.js", aliases);
    expect(result).toBe("/project/src/shared/types.js");
  });

  test("resolves exact alias", () => {
    const result = resolveAlias("#config", aliases);
    expect(result).toBe("/project/src/config.ts");
  });

  test("returns null for non-matching specifier", () => {
    const result = resolveAlias("./local.js", aliases);
    expect(result).toBeNull();
  });

  test("returns null for bare package specifier", () => {
    const result = resolveAlias("effect", aliases);
    expect(result).toBeNull();
  });
});
