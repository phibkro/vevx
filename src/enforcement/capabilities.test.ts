import { describe, test, expect } from "bun:test";

import type { Manifest } from "#shared/types.js";

import { verifyCapabilities } from "./capabilities.js";

const manifest: Manifest = {
  varp: "0.1.0",
  components: {
    auth: { path: "/project/src/auth", docs: [] },
    api: { path: "/project/src/api", deps: ["auth"], docs: [] },
  },
};

describe("verifyCapabilities", () => {
  test("valid — all changes within declared writes", () => {
    const result = verifyCapabilities(manifest, { writes: ["auth"] }, [
      "/project/src/auth/middleware.ts",
      "/project/src/auth/utils.ts",
    ]);
    expect(result.valid).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  test("violation — change outside declared write set", () => {
    const result = verifyCapabilities(manifest, { writes: ["auth"] }, [
      "/project/src/auth/middleware.ts",
      "/project/src/api/routes.ts",
    ]);
    expect(result.valid).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].actual_component).toBe("api");
  });

  test("violation — change outside all components", () => {
    const result = verifyCapabilities(manifest, { writes: ["auth"] }, [
      "/project/src/auth/middleware.ts",
      "/project/package.json",
    ]);
    expect(result.valid).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].actual_component).toBe("outside all components");
  });

  test("no violations when no writes declared and no changes", () => {
    const result = verifyCapabilities(manifest, { reads: ["auth"] }, []);
    expect(result.valid).toBe(true);
  });

  test("overlapping paths match the more specific component", () => {
    const overlappingManifest: Manifest = {
      varp: "0.1.0",
      components: {
        src: { path: "/project/src", docs: [] },
        auth: { path: "/project/src/auth", docs: [] },
      },
    };

    const result = verifyCapabilities(overlappingManifest, { writes: ["auth"] }, [
      "/project/src/auth/login.ts",
    ]);
    expect(result.valid).toBe(true);
    expect(result.violations).toHaveLength(0);
  });
});
