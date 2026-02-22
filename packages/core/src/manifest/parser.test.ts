import { describe, test, expect } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { parseManifest } from "./parser.js";

const FIXTURE_DIR = resolve(import.meta.dir, "../../test-fixtures");
const PROJECT_ROOT = resolve(import.meta.dir, "../../../..");

describe("parseManifest", () => {
  test("parses the project's own varp.yaml", () => {
    const manifest = parseManifest(resolve(PROJECT_ROOT, "varp.yaml"));

    expect(manifest.varp).toBe("0.1.0");
    expect(Object.keys(manifest.components).length).toBeGreaterThanOrEqual(8);
    expect(manifest.components.shared).toBeDefined();
    expect(manifest.components.shared.path).toBe(resolve(PROJECT_ROOT, "packages/core/src/shared"));
    expect(manifest.components.shared.stability).toBe("stable");
    expect(manifest.components.mcp).toBeDefined();
    expect(manifest.components.mcp.path).toBe(resolve(PROJECT_ROOT, "packages/mcp/src"));
    expect(manifest.components.mcp.deps).toEqual([
      "shared",
      "manifest",
      "plan",
      "scheduler",
      "enforcement",
      "analysis",
    ]);
    expect(manifest.components.manifest).toBeDefined();
    expect(manifest.components.manifest.path).toBe(
      resolve(PROJECT_ROOT, "packages/core/src/manifest"),
    );
    expect(manifest.components.manifest.deps).toEqual(["shared"]);

    // cli depends on tag "core" — should expand to all core-tagged components
    const cliDeps = manifest.components.cli.deps!;
    expect(cliDeps).toContain("shared");
    expect(cliDeps).toContain("manifest");
    expect(cliDeps).toContain("mcp");
    expect(cliDeps).toContain("analysis");
    expect(cliDeps).not.toContain("cli"); // self-exclusion
    expect(cliDeps).not.toContain("core"); // tag itself should not appear
  });

  test("parses manifest with dependencies", () => {
    const manifest = parseManifest(resolve(FIXTURE_DIR, "multi-component.yaml"));

    expect(Object.keys(manifest.components)).toEqual(["auth", "api", "web"]);
    expect(manifest.components.api.deps).toEqual(["auth"]);
    expect(manifest.components.web.deps).toEqual(["auth", "api"]);
  });

  test("parses tags, test, env, and stability fields", () => {
    const manifest = parseManifest(resolve(FIXTURE_DIR, "multi-component.yaml"));

    expect(manifest.components.auth.tags).toEqual(["security", "api-boundary"]);
    expect(manifest.components.auth.stability).toBe("stable");
    expect(manifest.components.auth.test).toBeUndefined();
    expect(manifest.components.auth.env).toBeUndefined();

    expect(manifest.components.api.env).toEqual(["DATABASE_URL"]);
    expect(manifest.components.api.test).toBe("bun test src/api --timeout 5000");
    expect(manifest.components.api.tags).toBeUndefined();

    expect(manifest.components.web.tags).toEqual(["frontend"]);
    expect(manifest.components.web.stability).toBe("active");
  });

  test("rejects invalid stability value", () => {
    expect(() => parseManifest(resolve(FIXTURE_DIR, "invalid-stability.yaml"))).toThrow();
  });

  test("throws on invalid manifest", () => {
    expect(() => parseManifest(resolve(FIXTURE_DIR, "invalid.yaml"))).toThrow();
  });

  test("parses flat YAML format without components wrapper", () => {
    const manifest = parseManifest(resolve(PROJECT_ROOT, "varp.yaml"));

    // Should have components directly from top-level keys
    expect(manifest.components.shared).toBeDefined();
    expect(manifest.components.mcp).toBeDefined();
    expect(manifest.components.skills).toBeDefined();
    expect(manifest.components.hooks).toBeDefined();
    // Should not have 'name' on manifest
    expect((manifest as any).name).toBeUndefined();
  });

  test("parses multi-path component (paths key)", () => {
    const manifest = parseManifest(resolve(FIXTURE_DIR, "multi-path.yaml"));

    const auth = manifest.components.auth;
    expect(Array.isArray(auth.path)).toBe(true);
    const paths = auth.path as string[];
    expect(paths).toHaveLength(3);
    expect(paths[0]).toBe(resolve(FIXTURE_DIR, "src/controllers/auth"));
    expect(paths[1]).toBe(resolve(FIXTURE_DIR, "src/services/auth"));
    expect(paths[2]).toBe(resolve(FIXTURE_DIR, "src/repositories/auth"));

    // Single-path component should remain a string
    expect(typeof manifest.components.single.path).toBe("string");
    expect(manifest.components.single.path).toBe(resolve(FIXTURE_DIR, "src/single"));
  });

  test("merges path + paths into single array", () => {
    const manifest = parseManifest(resolve(FIXTURE_DIR, "merged-paths.yaml"));

    const auth = manifest.components.auth;
    expect(Array.isArray(auth.path)).toBe(true);
    const paths = auth.path as string[];
    expect(paths).toHaveLength(3);
    expect(paths[0]).toBe(resolve(FIXTURE_DIR, "src/controllers/auth"));
    expect(paths[1]).toBe(resolve(FIXTURE_DIR, "src/services/auth"));
    expect(paths[2]).toBe(resolve(FIXTURE_DIR, "src/repositories/auth"));
  });

  test("rejects component with neither path nor paths", () => {
    const tmpDir = join("/tmp/claude", "no-path-test");
    rmSync(tmpDir, { recursive: true, force: true });
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(join(tmpDir, "varp.yaml"), `varp: 0.1.0\nbad:\n  deps: []\n`);
    try {
      expect(() => parseManifest(join(tmpDir, "varp.yaml"))).toThrow();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("resolves doc paths to absolute paths", () => {
    const manifest = parseManifest(resolve(PROJECT_ROOT, "varp.yaml"));

    // server component has no explicit docs; manifest component docs are auto-discovered
    for (const component of Object.values(manifest.components)) {
      for (const doc of component.docs) {
        expect(doc).toMatch(/^\//); // absolute path
      }
    }
  });

  test("rejects single path that escapes manifest directory", () => {
    const tmpDir = join("/tmp/claude", "traversal-test");
    rmSync(tmpDir, { recursive: true, force: true });
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(join(tmpDir, "varp.yaml"), `varp: 0.1.0\nbad:\n  path: ../../escape\n`);
    try {
      expect(() => parseManifest(join(tmpDir, "varp.yaml"))).toThrow("escapes manifest directory");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("rejects multi-path where one path escapes", () => {
    const tmpDir = join("/tmp/claude", "traversal-multi-test");
    rmSync(tmpDir, { recursive: true, force: true });
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(
      join(tmpDir, "varp.yaml"),
      `varp: 0.1.0\nbad:\n  paths:\n    - ./src/ok\n    - ../../escape\n`,
    );
    try {
      expect(() => parseManifest(join(tmpDir, "varp.yaml"))).toThrow("escapes manifest directory");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("tag-based deps", () => {
  let counter = 0;
  function parseInline(yaml: string) {
    const tmpDir = join("/tmp/claude", `tag-deps-test-${process.pid}-${counter++}`);
    rmSync(tmpDir, { recursive: true, force: true });
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(join(tmpDir, "varp.yaml"), yaml);
    try {
      return parseManifest(join(tmpDir, "varp.yaml"));
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  test("tag dep expands to all tagged components", () => {
    const m = parseInline(`varp: 0.1.0
a:
  path: ./a
  tags: [backend]
b:
  path: ./b
  tags: [backend]
c:
  path: ./c
  deps: [backend]
`);
    expect(m.components.c.deps!.sort()).toEqual(["a", "b"]);
  });

  test("component name dep is unchanged", () => {
    const m = parseInline(`varp: 0.1.0
a:
  path: ./a
b:
  path: ./b
  deps: [a]
`);
    expect(m.components.b.deps).toEqual(["a"]);
  });

  test("mixed component + tag deps both resolve", () => {
    const m = parseInline(`varp: 0.1.0
a:
  path: ./a
  tags: [lib]
b:
  path: ./b
  tags: [lib]
c:
  path: ./c
d:
  path: ./d
  deps: [c, lib]
`);
    expect(m.components.d.deps!.sort()).toEqual(["a", "b", "c"]);
  });

  test("self-exclusion: tagged component depending on own tag", () => {
    const m = parseInline(`varp: 0.1.0
a:
  path: ./a
  tags: [core]
b:
  path: ./b
  tags: [core]
  deps: [core]
`);
    // b depends on tag "core" but should not depend on itself
    expect(m.components.b.deps).toEqual(["a"]);
  });

  test("unknown dep throws", () => {
    expect(() =>
      parseInline(`varp: 0.1.0
a:
  path: ./a
  deps: [nonexistent]
`),
    ).toThrow('unknown dep "nonexistent"');
  });

  test("component name takes priority over same-named tag", () => {
    // If a component and a tag share the same name, the component wins
    const m = parseInline(`varp: 0.1.0
lib:
  path: ./lib
a:
  path: ./a
  tags: [lib]
b:
  path: ./b
  deps: [lib]
`);
    // "lib" matches the component name, not the tag
    expect(m.components.b.deps).toEqual(["lib"]);
  });

  test("deduplication when tag expands to already-listed component", () => {
    const m = parseInline(`varp: 0.1.0
a:
  path: ./a
  tags: [lib]
b:
  path: ./b
  tags: [lib]
c:
  path: ./c
  deps: [a, lib]
`);
    // "a" is listed explicitly AND via tag "lib" — should appear once
    const deps = m.components.c.deps!;
    expect(deps.filter((d) => d === "a")).toHaveLength(1);
    expect(deps.sort()).toEqual(["a", "b"]);
  });
});
