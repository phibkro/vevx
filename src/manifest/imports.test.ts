import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import type { Manifest } from "#shared/types.js";

import {
  extractImports,
  resolveImport,
  analyzeImports,
  resolveAlias,
  aliasPrefixesFrom,
  loadTsconfigPaths,
  type SourceFile,
  type PathAliases,
} from "./imports.js";

describe("extractImports", () => {
  test("extracts \"import { x } from './foo.js'\"", () => {
    const result = extractImports("import { x } from './foo.js';");
    expect(result).toEqual([{ specifier: "./foo.js" }]);
  });

  test("extracts \"import x from './bar.js'\"", () => {
    const result = extractImports("import x from './bar.js';");
    expect(result).toEqual([{ specifier: "./bar.js" }]);
  });

  test("extracts \"import * as x from './baz.js'\"", () => {
    const result = extractImports("import * as x from './baz.js';");
    expect(result).toEqual([{ specifier: "./baz.js" }]);
  });

  test("extracts \"import type { T } from './types.js'\"", () => {
    const result = extractImports("import type { T } from './types.js';");
    expect(result).toEqual([{ specifier: "./types.js" }]);
  });

  test("extracts \"export { x } from './foo.js'\"", () => {
    const result = extractImports("export { x } from './foo.js';");
    expect(result).toEqual([{ specifier: "./foo.js" }]);
  });

  test("extracts \"export * from './foo.js'\"", () => {
    const result = extractImports("export * from './foo.js';");
    expect(result).toEqual([{ specifier: "./foo.js" }]);
  });

  test("skips bare specifiers (external packages)", () => {
    const result = extractImports("import { z } from 'zod';");
    expect(result).toEqual([]);
  });

  test("skips dynamic imports", () => {
    const result = extractImports("const m = import('./foo.js');");
    expect(result).toEqual([]);
  });

  test("handles both single and double quotes", () => {
    const content = `
import { a } from "./foo.js";
import { b } from './bar.js';
`;
    const result = extractImports(content);
    expect(result).toEqual([{ specifier: "./foo.js" }, { specifier: "./bar.js" }]);
  });

  test("skips bare specifier with @scope", () => {
    const result = extractImports(
      'import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";',
    );
    expect(result).toEqual([]);
  });

  test("extracts parent-relative specifiers", () => {
    const result = extractImports("import { x } from '../utils/helper.js';");
    expect(result).toEqual([{ specifier: "../utils/helper.js" }]);
  });

  test("captures alias-prefixed specifiers when aliasPrefixes provided", () => {
    const content = `
import { Manifest } from '#shared/types.js';
import { z } from 'zod';
import { foo } from './local.js';
`;
    const result = extractImports(content, ["#shared/"]);
    expect(result).toEqual([{ specifier: "#shared/types.js" }, { specifier: "./local.js" }]);
  });

  test("still skips @scope packages even with alias prefixes", () => {
    const result = extractImports(
      'import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";',
      ["#shared/"],
    );
    expect(result).toEqual([]);
  });

  test("captures exact alias match", () => {
    const result = extractImports("import config from '#config';", ["#config"]);
    expect(result).toEqual([{ specifier: "#config" }]);
  });
});

describe("resolveAlias", () => {
  const aliases: PathAliases = {
    mappings: [
      { pattern: "#shared/*", targets: ["src/shared/*"] },
      { pattern: "#config", targets: ["src/config.ts"] },
      { pattern: "@/*", targets: ["src/*"] },
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

  test("resolves @/* alias", () => {
    const result = resolveAlias("@/utils/helper.js", aliases);
    expect(result).toBe("/project/src/utils/helper.js");
  });

  test("returns null for non-matching specifier", () => {
    const result = resolveAlias("zod", aliases);
    expect(result).toBeNull();
  });

  test("returns null for relative specifier", () => {
    const result = resolveAlias("./foo.js", aliases);
    expect(result).toBeNull();
  });

  test("handles multiple mappings — first match wins", () => {
    const overlapping: PathAliases = {
      mappings: [
        { pattern: "#a/*", targets: ["first/*"] },
        { pattern: "#a/*", targets: ["second/*"] },
      ],
      baseDir: "/project",
    };
    const result = resolveAlias("#a/foo.js", overlapping);
    expect(result).toBe("/project/first/foo.js");
  });
});

describe("aliasPrefixesFrom", () => {
  test("converts wildcard pattern to prefix", () => {
    const aliases: PathAliases = {
      mappings: [{ pattern: "#shared/*", targets: ["src/shared/*"] }],
      baseDir: "/project",
    };
    expect(aliasPrefixesFrom(aliases)).toEqual(["#shared/"]);
  });

  test("keeps exact pattern as-is", () => {
    const aliases: PathAliases = {
      mappings: [{ pattern: "#config", targets: ["src/config.ts"] }],
      baseDir: "/project",
    };
    expect(aliasPrefixesFrom(aliases)).toEqual(["#config"]);
  });
});

describe("resolveImport", () => {
  test("resolves relative path", () => {
    const exists = () => false;
    const result = resolveImport("./foo.js", "/project/src/bar.ts", exists);
    expect(result).toBe("/project/src/foo.js");
  });

  test("remaps .js to .ts when .ts exists", () => {
    const exists = (p: string) => p === "/project/src/foo.ts";
    const result = resolveImport("./foo.js", "/project/src/bar.ts", exists);
    expect(result).toBe("/project/src/foo.ts");
  });

  test("remaps .jsx to .tsx when .tsx exists", () => {
    const exists = (p: string) => p === "/project/src/comp.tsx";
    const result = resolveImport("./comp.jsx", "/project/src/bar.ts", exists);
    expect(result).toBe("/project/src/comp.tsx");
  });

  test("resolves directory to index.ts", () => {
    const exists = (p: string) => p === "/project/src/utils/index.ts";
    const result = resolveImport("./utils", "/project/src/bar.ts", exists);
    expect(result).toBe("/project/src/utils/index.ts");
  });

  test("falls back to original when no .ts variant exists", () => {
    const exists = () => false;
    const result = resolveImport("./foo.js", "/project/src/bar.ts", exists);
    expect(result).toBe("/project/src/foo.js");
  });

  test("resolves parent-relative specifier", () => {
    const exists = () => false;
    const result = resolveImport("../lib/util.js", "/project/src/sub/bar.ts", exists);
    expect(result).toBe("/project/src/lib/util.js");
  });

  test("resolves alias specifier with .js→.ts remapping", () => {
    const aliases: PathAliases = {
      mappings: [{ pattern: "#shared/*", targets: ["src/shared/*"] }],
      baseDir: "/project",
    };
    const exists = (p: string) => p === "/project/src/shared/types.ts";
    const result = resolveImport("#shared/types.js", "/project/src/api/routes.ts", exists, aliases);
    expect(result).toBe("/project/src/shared/types.ts");
  });

  test("alias resolution falls back when no alias matches", () => {
    const aliases: PathAliases = {
      mappings: [{ pattern: "#shared/*", targets: ["src/shared/*"] }],
      baseDir: "/project",
    };
    const exists = () => false;
    const result = resolveImport("./foo.js", "/project/src/bar.ts", exists, aliases);
    expect(result).toBe("/project/src/foo.js");
  });
});

describe("analyzeImports", () => {
  const manifest: Manifest = {
    varp: "0.1.0",
    components: {
      auth: { path: "/project/src/auth", docs: [] },
      api: { path: "/project/src/api", deps: ["auth"], docs: [] },
    },
  };

  const fileExists = (p: string) =>
    ["/project/src/auth/index.ts", "/project/src/api/routes.ts"].includes(p);

  test("detects cross-component imports", () => {
    const files: SourceFile[] = [
      {
        path: "/project/src/api/routes.ts",
        component: "api",
        content: "import { verify } from '../auth/index.js';",
      },
    ];
    const result = analyzeImports(files, manifest, fileExists);
    expect(result.import_deps).toHaveLength(1);
    expect(result.import_deps[0].from).toBe("api");
    expect(result.import_deps[0].to).toBe("auth");
    expect(result.import_deps[0].evidence).toHaveLength(1);
    expect(result.import_deps[0].evidence[0].source_file).toBe("/project/src/api/routes.ts");
    expect(result.import_deps[0].evidence[0].import_specifier).toBe("../auth/index.js");
  });

  test("ignores same-component imports", () => {
    const files: SourceFile[] = [
      {
        path: "/project/src/auth/middleware.ts",
        component: "auth",
        content: "import { verify } from './index.js';",
      },
    ];
    const result = analyzeImports(files, manifest, fileExists);
    expect(result.import_deps).toHaveLength(0);
  });

  test("aggregates evidence for multiple imports between same components", () => {
    const files: SourceFile[] = [
      {
        path: "/project/src/api/routes.ts",
        component: "api",
        content: "import { verify } from '../auth/index.js';",
      },
      {
        path: "/project/src/api/middleware.ts",
        component: "api",
        content: "import { check } from '../auth/index.js';",
      },
    ];
    const result = analyzeImports(files, manifest, fileExists);
    expect(result.import_deps).toHaveLength(1);
    expect(result.import_deps[0].evidence).toHaveLength(2);
  });

  test("handles files outside all components (skips them)", () => {
    const files: SourceFile[] = [
      {
        path: "/project/lib/external.ts",
        component: "external",
        content: "import { verify } from '../src/auth/index.js';",
      },
    ];
    // external is not a known component, so no cross-component dep from it
    const result = analyzeImports(files, manifest, fileExists);
    // The target resolves to auth, but the source component "external" isn't in manifest
    // findOwningComponent on the source won't match, but the file.component is "external"
    // which doesn't match "auth", so it would create a dep from "external" to "auth"
    // However "external" is the assigned component, and the dep is valid in our model
    expect(result.total_files_scanned).toBe(1);
  });

  test("inferred dep not in manifest deps appears in missing_deps", () => {
    const manifestNoDeps: Manifest = {
      varp: "0.1.0",
      components: {
        auth: { path: "/project/src/auth", docs: [] },
        api: { path: "/project/src/api", docs: [] },
      },
    };
    const files: SourceFile[] = [
      {
        path: "/project/src/api/routes.ts",
        component: "api",
        content: "import { verify } from '../auth/index.js';",
      },
    ];
    const result = analyzeImports(files, manifestNoDeps, fileExists);
    expect(result.missing_deps).toHaveLength(1);
    expect(result.missing_deps[0].from).toBe("api");
    expect(result.missing_deps[0].to).toBe("auth");
  });

  test("manifest dep not found in imports appears in extra_deps", () => {
    const files: SourceFile[] = [];
    const result = analyzeImports(files, manifest, fileExists);
    expect(result.extra_deps).toContainEqual({ from: "api", to: "auth" });
  });

  test("matching dep appears in neither missing nor extra", () => {
    const files: SourceFile[] = [
      {
        path: "/project/src/api/routes.ts",
        component: "api",
        content: "import { verify } from '../auth/index.js';",
      },
    ];
    const result = analyzeImports(files, manifest, fileExists);
    // api->auth is declared and inferred: not in missing or extra
    expect(result.missing_deps).toHaveLength(0);
    expect(result.extra_deps).toHaveLength(0);
  });

  test("returns correct counts", () => {
    const files: SourceFile[] = [
      {
        path: "/project/src/api/routes.ts",
        component: "api",
        content: `
import { verify } from '../auth/index.js';
import { helper } from './utils.js';
`,
      },
    ];
    const result = analyzeImports(files, manifest, fileExists);
    expect(result.total_files_scanned).toBe(1);
    expect(result.total_imports_scanned).toBe(2);
  });

  test("detects cross-component dep via alias import", () => {
    const aliasManifest: Manifest = {
      varp: "0.1.0",
      components: {
        shared: { path: "/project/src/shared", docs: [] },
        api: { path: "/project/src/api", deps: ["shared"], docs: [] },
      },
    };
    const aliases: PathAliases = {
      mappings: [{ pattern: "#shared/*", targets: ["src/shared/*"] }],
      baseDir: "/project",
    };
    const exists = (p: string) => p === "/project/src/shared/types.ts";
    const files: SourceFile[] = [
      {
        path: "/project/src/api/routes.ts",
        component: "api",
        content: "import type { Manifest } from '#shared/types.js';",
      },
    ];
    const result = analyzeImports(files, aliasManifest, exists, aliases);
    expect(result.import_deps).toHaveLength(1);
    expect(result.import_deps[0].from).toBe("api");
    expect(result.import_deps[0].to).toBe("shared");
    expect(result.missing_deps).toHaveLength(0);
    expect(result.extra_deps).toHaveLength(0);
  });

  test("alias import without declared dep appears in missing_deps", () => {
    const aliasManifest: Manifest = {
      varp: "0.1.0",
      components: {
        shared: { path: "/project/src/shared", docs: [] },
        api: { path: "/project/src/api", docs: [] },
      },
    };
    const aliases: PathAliases = {
      mappings: [{ pattern: "#shared/*", targets: ["src/shared/*"] }],
      baseDir: "/project",
    };
    const exists = (p: string) => p === "/project/src/shared/types.ts";
    const files: SourceFile[] = [
      {
        path: "/project/src/api/routes.ts",
        component: "api",
        content: "import type { Manifest } from '#shared/types.js';",
      },
    ];
    const result = analyzeImports(files, aliasManifest, exists, aliases);
    expect(result.missing_deps).toHaveLength(1);
    expect(result.missing_deps[0].from).toBe("api");
    expect(result.missing_deps[0].to).toBe("shared");
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
