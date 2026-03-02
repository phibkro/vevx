import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  aliasPrefixesFrom,
  bunResolve,
  loadTsconfigPaths,
  resolveAlias,
  resolveSpecifier,
  type PathAliases,
} from "./Resolve.js";

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

describe("aliasPrefixesFrom", () => {
  test("strips wildcard suffix from patterns", () => {
    const aliases: PathAliases = {
      mappings: [
        { pattern: "#shared/*", targets: ["./src/shared/*"] },
        { pattern: "#config", targets: ["./src/config.ts"] },
      ],
      baseDir: "/project",
    };
    const prefixes = aliasPrefixesFrom(aliases);
    expect(prefixes).toEqual(["#shared/", "#config"]);
  });
});

describe("resolveSpecifier", () => {
  const mockResolve = (spec: string, _dir: string) =>
    spec === "./resolved.js" ? "/project/resolved.ts" : null;

  test("resolves alias then falls through to resolveFn", () => {
    const aliases: PathAliases = {
      mappings: [{ pattern: "#lib/*", targets: ["./src/lib/*"] }],
      baseDir: "/project",
    };
    // alias resolves to /project/src/lib/foo.js, resolveFn returns null → fallback to aliased path
    const result = resolveSpecifier("#lib/foo.js", "/project", mockResolve, aliases);
    expect(result).toBe("/project/src/lib/foo.js");
  });

  test("skips alias for relative specifiers", () => {
    const aliases: PathAliases = {
      mappings: [{ pattern: "#lib/*", targets: ["./src/lib/*"] }],
      baseDir: "/project",
    };
    const result = resolveSpecifier("./resolved.js", "/project", mockResolve, aliases);
    expect(result).toBe("/project/resolved.ts");
  });

  test("delegates directly to resolveFn without aliases", () => {
    const result = resolveSpecifier("./resolved.js", "/project", mockResolve);
    expect(result).toBe("/project/resolved.ts");
  });
});

describe("bunResolve", () => {
  test("returns null for unresolvable specifier", () => {
    const result = bunResolve("nonexistent-package-xyz-42", "/tmp");
    expect(result).toBeNull();
  });
});

describe("loadTsconfigPaths — edge cases", () => {
  test("returns null for malformed JSON", () => {
    const dir = mkdtempSync(join("/tmp/claude/", "resolve-"));
    try {
      writeFileSync(join(dir, "tsconfig.json"), "{ invalid json !!!");
      const result = loadTsconfigPaths(dir);
      expect(result).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("follows extends to node_modules package", () => {
    const dir = mkdtempSync(join("/tmp/claude/", "resolve-"));
    try {
      mkdirSync(join(dir, "node_modules", "@tsconfig", "node20"), { recursive: true });
      writeFileSync(
        join(dir, "node_modules", "@tsconfig", "node20", "tsconfig.json"),
        JSON.stringify({
          compilerOptions: { paths: { "#base/*": ["./base/*"] } },
        }),
      );
      writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ extends: "@tsconfig/node20" }));
      const result = loadTsconfigPaths(dir);
      expect(result).not.toBeNull();
      expect(result!.mappings[0].pattern).toBe("#base/*");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("follows extends to node_modules .json file", () => {
    const dir = mkdtempSync(join("/tmp/claude/", "resolve-"));
    try {
      mkdirSync(join(dir, "node_modules"), { recursive: true });
      writeFileSync(
        join(dir, "node_modules", "shared-tsconfig.json"),
        JSON.stringify({
          compilerOptions: { paths: { "#nm/*": ["./nm/*"] } },
        }),
      );
      writeFileSync(
        join(dir, "tsconfig.json"),
        JSON.stringify({ extends: "shared-tsconfig.json" }),
      );
      const result = loadTsconfigPaths(dir);
      expect(result).not.toBeNull();
      expect(result!.mappings[0].pattern).toBe("#nm/*");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("follows relative extends without .json suffix", () => {
    const dir = mkdtempSync(join("/tmp/claude/", "resolve-"));
    try {
      writeFileSync(
        join(dir, "base.json"),
        JSON.stringify({
          compilerOptions: { paths: { "#rel/*": ["./rel/*"] } },
        }),
      );
      writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ extends: "./base" }));
      const result = loadTsconfigPaths(dir);
      expect(result).not.toBeNull();
      expect(result!.mappings[0].pattern).toBe("#rel/*");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
