import { describe, test, expect } from "bun:test";

import { findOwningComponent, resolveComponentRefs } from "./ownership.js";
import { componentPaths, type Manifest } from "./types.js";

const manifest: Manifest = {
  varp: "0.1.0",
  components: {
    auth: { path: "/project/src/auth", docs: [] },
    api: { path: "/project/src/api", deps: ["auth"], docs: [] },
    src: { path: "/project/src", docs: [] },
  },
};

describe("componentPaths", () => {
  test("normalizes string to single-element array", () => {
    expect(componentPaths({ path: "/a/b", docs: [] })).toEqual(["/a/b"]);
  });

  test("passes through string array unchanged", () => {
    expect(componentPaths({ path: ["/a/b", "/c/d"], docs: [] })).toEqual(["/a/b", "/c/d"]);
  });
});

describe("findOwningComponent", () => {
  test("matches file to its component", () => {
    expect(findOwningComponent("/project/src/auth/middleware.ts", manifest)).toBe("auth");
    expect(findOwningComponent("/project/src/api/routes.ts", manifest)).toBe("api");
  });

  test("prefers longer (more specific) path match", () => {
    // /project/src/auth is more specific than /project/src
    expect(findOwningComponent("/project/src/auth/login.ts", manifest)).toBe("auth");
  });

  test("falls back to broader component", () => {
    // /project/src/utils is under src but not auth or api
    expect(findOwningComponent("/project/src/utils/helper.ts", manifest)).toBe("src");
  });

  test("returns null for files outside all components", () => {
    expect(findOwningComponent("/other/path/file.ts", manifest)).toBeNull();
    expect(findOwningComponent("/project/package.json", manifest)).toBeNull();
  });

  test("matches files across multi-path component", () => {
    const multiManifest: Manifest = {
      varp: "0.1.0",
      components: {
        auth: {
          path: ["/project/src/controllers/auth", "/project/src/services/auth"],
          docs: [],
        },
        shared: { path: "/project/src/shared", docs: [] },
      },
    };

    expect(findOwningComponent("/project/src/controllers/auth/login.ts", multiManifest)).toBe(
      "auth",
    );
    expect(findOwningComponent("/project/src/services/auth/jwt.ts", multiManifest)).toBe("auth");
    expect(findOwningComponent("/project/src/shared/util.ts", multiManifest)).toBe("shared");
  });
});

describe("resolveComponentRefs", () => {
  const tagged: Manifest = {
    varp: "0.1.0",
    components: {
      shared: { path: "/p/shared", docs: [], tags: ["core"] },
      manifest: { path: "/p/manifest", docs: [], tags: ["core"] },
      plan: { path: "/p/plan", docs: [], tags: ["core"] },
      skills: { path: "/p/skills", docs: [], tags: ["plugin"] },
      hooks: { path: "/p/hooks", docs: [], tags: ["plugin"] },
      cli: { path: "/p/cli", docs: [] },
    },
  };

  test("component names pass through", () => {
    expect(resolveComponentRefs(tagged, ["shared", "cli"])).toEqual(["shared", "cli"]);
  });

  test("tag expands to all tagged components", () => {
    expect(resolveComponentRefs(tagged, ["core"]).sort()).toEqual(["manifest", "plan", "shared"]);
  });

  test("mixed refs resolve and deduplicate", () => {
    // "shared" listed explicitly + also in "core" tag
    const result = resolveComponentRefs(tagged, ["shared", "core"]);
    expect(result.filter((r) => r === "shared")).toHaveLength(1);
    expect(result.sort()).toEqual(["manifest", "plan", "shared"]);
  });

  test("unknown ref throws", () => {
    expect(() => resolveComponentRefs(tagged, ["nonexistent"])).toThrow(
      'Unknown component or tag: "nonexistent"',
    );
  });

  test("component name wins over same-named tag", () => {
    const ambiguous: Manifest = {
      varp: "0.1.0",
      components: {
        lib: { path: "/p/lib", docs: [] },
        a: { path: "/p/a", docs: [], tags: ["lib"] },
        b: { path: "/p/b", docs: [], tags: ["lib"] },
      },
    };
    // "lib" matches the component, not the tag
    expect(resolveComponentRefs(ambiguous, ["lib"])).toEqual(["lib"]);
  });
});
