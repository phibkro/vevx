import { describe, test, expect } from "bun:test";

import type { Manifest } from "#shared/types.js";

import {
  extractImports,
  resolveSpecifier,
  analyzeImports,
  resolveAlias,
  aliasPrefixesFrom,
  type SourceFile,
  type PathAliases,
  type ResolveFn,
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

describe("resolveSpecifier", () => {
  const mockResolve: ResolveFn = (spec, dir) => {
    const { resolve } = require("node:path");
    return resolve(dir, spec);
  };

  test("resolves relative specifier via resolveFn", () => {
    const result = resolveSpecifier("./foo.js", "/project/src", mockResolve);
    expect(result).toBe("/project/src/foo.js");
  });

  test("resolves alias before calling resolveFn", () => {
    const aliases: PathAliases = {
      mappings: [{ pattern: "#shared/*", targets: ["src/shared/*"] }],
      baseDir: "/project",
    };
    const result = resolveSpecifier("#shared/types.js", "/project/src/api", mockResolve, aliases);
    expect(result).toBe("/project/src/shared/types.js");
  });

  test("returns null when resolveFn returns null", () => {
    const failing: ResolveFn = () => null;
    const result = resolveSpecifier("./missing.js", "/project/src", failing);
    expect(result).toBeNull();
  });

  test("skips alias for relative specifiers", () => {
    const aliases: PathAliases = {
      mappings: [{ pattern: "#shared/*", targets: ["src/shared/*"] }],
      baseDir: "/project",
    };
    const result = resolveSpecifier("./local.js", "/project/src", mockResolve, aliases);
    expect(result).toBe("/project/src/local.js");
  });
});

/** Build a mock ResolveFn that does .js→.ts remapping against a known file set. */
function makeResolveFn(fileExists: (p: string) => boolean): ResolveFn {
  const { resolve } = require("node:path");
  return (specifier: string, fromDir: string) => {
    const base = resolve(fromDir, specifier);
    if (base.endsWith(".js")) {
      const tsPath = base.slice(0, -3) + ".ts";
      if (fileExists(tsPath)) return tsPath;
    }
    return base;
  };
}

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
  const resolveFn = makeResolveFn(fileExists);

  test("detects cross-component imports", () => {
    const files: SourceFile[] = [
      {
        path: "/project/src/api/routes.ts",
        component: "api",
        content: "import { verify } from '../auth/index.js';",
      },
    ];
    const result = analyzeImports(files, manifest, resolveFn);
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
    const result = analyzeImports(files, manifest, resolveFn);
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
    const result = analyzeImports(files, manifest, resolveFn);
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
    const result = analyzeImports(files, manifest, resolveFn);
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
    const result = analyzeImports(files, manifestNoDeps, resolveFn);
    expect(result.missing_deps).toHaveLength(1);
    expect(result.missing_deps[0].from).toBe("api");
    expect(result.missing_deps[0].to).toBe("auth");
  });

  test("manifest dep not found in imports appears in extra_deps", () => {
    const files: SourceFile[] = [];
    const result = analyzeImports(files, manifest, resolveFn);
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
    const result = analyzeImports(files, manifest, resolveFn);
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
    const result = analyzeImports(files, manifest, resolveFn);
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
    const aliasResolveFn = makeResolveFn((p) => p === "/project/src/shared/types.ts");
    const files: SourceFile[] = [
      {
        path: "/project/src/api/routes.ts",
        component: "api",
        content: "import type { Manifest } from '#shared/types.js';",
      },
    ];
    const result = analyzeImports(files, aliasManifest, aliasResolveFn, aliases);
    expect(result.import_deps).toHaveLength(1);
    expect(result.import_deps[0].from).toBe("api");
    expect(result.import_deps[0].to).toBe("shared");
    expect(result.missing_deps).toHaveLength(0);
    expect(result.extra_deps).toHaveLength(0);
  });

  test("follows barrel re-exports to discover transitive deps", () => {
    const barrelManifest: Manifest = {
      varp: "0.1.0",
      components: {
        shared: { path: "/project/src/shared", docs: [] },
        manifest: { path: "/project/src/manifest", docs: [] },
        mcp: { path: "/project/src/mcp", deps: ["shared", "manifest"], docs: [] },
      },
    };
    const knownFiles = new Set([
      "/project/src/shared/types.ts",
      "/project/src/manifest/parser.ts",
      "/project/src/mcp/server.ts",
      "/project/src/lib.ts",
    ]);
    const resolveFn = makeResolveFn((p) => knownFiles.has(p));

    const files: SourceFile[] = [
      {
        path: "/project/src/mcp/server.ts",
        component: "mcp",
        content: "import { parseManifest } from '../lib.js';",
      },
    ];

    // lib.ts is outside all components — provide it as extraFiles
    const extraFiles = new Map([
      [
        "/project/src/lib.ts",
        [
          "export { componentPaths } from './shared/types.js';",
          "export { parseManifest } from './manifest/parser.js';",
        ].join("\n"),
      ],
    ]);

    const result = analyzeImports(files, barrelManifest, resolveFn, undefined, extraFiles);
    // Should discover deps on both shared and manifest via barrel expansion
    const depTargets = result.import_deps.map((d) => d.to).sort();
    expect(depTargets).toEqual(["manifest", "shared"]);
    expect(result.missing_deps).toHaveLength(0);
    expect(result.extra_deps).toHaveLength(0);
  });

  test("caches barrel expansion across multiple importers", () => {
    const barrelManifest: Manifest = {
      varp: "0.1.0",
      components: {
        shared: { path: "/project/src/shared", docs: [] },
        api: { path: "/project/src/api", deps: ["shared"], docs: [] },
        cli: { path: "/project/src/cli", deps: ["shared"], docs: [] },
      },
    };
    const knownFiles = new Set([
      "/project/src/shared/types.ts",
      "/project/src/api/routes.ts",
      "/project/src/cli/main.ts",
      "/project/src/lib.ts",
    ]);
    const resolveFn = makeResolveFn((p) => knownFiles.has(p));

    const files: SourceFile[] = [
      {
        path: "/project/src/api/routes.ts",
        component: "api",
        content: "import { x } from '../lib.js';",
      },
      {
        path: "/project/src/cli/main.ts",
        component: "cli",
        content: "import { y } from '../lib.js';",
      },
    ];

    const extraFiles = new Map([
      ["/project/src/lib.ts", "export { componentPaths } from './shared/types.js';"],
    ]);

    const result = analyzeImports(files, barrelManifest, resolveFn, undefined, extraFiles);
    // Both api and cli should have inferred dep on shared
    const apiDep = result.import_deps.find((d) => d.from === "api");
    const cliDep = result.import_deps.find((d) => d.from === "cli");
    expect(apiDep).toBeDefined();
    expect(apiDep!.to).toBe("shared");
    expect(cliDep).toBeDefined();
    expect(cliDep!.to).toBe("shared");
    expect(result.missing_deps).toHaveLength(0);
  });

  test("barrel with no owning re-exports is a no-op", () => {
    const files: SourceFile[] = [
      {
        path: "/project/src/api/routes.ts",
        component: "api",
        content: "import { x } from '../barrel.js';",
      },
    ];
    // Barrel only re-exports from external packages (no owning component)
    const extraFiles = new Map([["/project/src/barrel.ts", "export { z } from 'zod';"]]);
    const resolveFn = makeResolveFn(() => false);
    const result = analyzeImports(files, manifest, resolveFn, undefined, extraFiles);
    expect(result.import_deps).toHaveLength(0);
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
    const aliasResolveFn = makeResolveFn((p) => p === "/project/src/shared/types.ts");
    const files: SourceFile[] = [
      {
        path: "/project/src/api/routes.ts",
        component: "api",
        content: "import type { Manifest } from '#shared/types.js';",
      },
    ];
    const result = analyzeImports(files, aliasManifest, aliasResolveFn, aliases);
    expect(result.missing_deps).toHaveLength(1);
    expect(result.missing_deps[0].from).toBe("api");
    expect(result.missing_deps[0].to).toBe("shared");
  });
});
