import { describe, test, expect } from "bun:test";
import { findOwningComponent } from "./ownership.js";
import type { Manifest } from "./types.js";

const manifest: Manifest = {
  varp: "0.1.0",
  components: {
    auth: { path: "/project/src/auth", docs: [] },
    api: { path: "/project/src/api", deps: ["auth"], docs: [] },
    src: { path: "/project/src", docs: [] },
  },
};

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
});
