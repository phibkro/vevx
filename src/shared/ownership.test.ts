import { describe, test, expect } from "bun:test";

import { findOwningComponent } from "./ownership.js";
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
