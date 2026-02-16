import { describe, test, expect } from "bun:test";
import { verifyCapabilities } from "./capabilities.js";
import type { Manifest } from "../types.js";

const manifest: Manifest = {
  varp: "0.1.0",
  name: "test",
  components: {
    auth: { path: "/project/src/auth", docs: { interface: "/docs/auth/interface.md", internal: "/docs/auth/internal.md" } },
    api: { path: "/project/src/api", depends_on: ["auth"], docs: { interface: "/docs/api/interface.md", internal: "/docs/api/internal.md" } },
  },
};

describe("verifyCapabilities", () => {
  test("valid — all changes within declared writes", () => {
    const result = verifyCapabilities(
      manifest,
      { writes: ["auth"] },
      ["/project/src/auth/middleware.ts", "/project/src/auth/utils.ts"],
    );
    expect(result.valid).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  test("violation — change outside declared write set", () => {
    const result = verifyCapabilities(
      manifest,
      { writes: ["auth"] },
      ["/project/src/auth/middleware.ts", "/project/src/api/routes.ts"],
    );
    expect(result.valid).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].actual_component).toBe("api");
  });

  test("violation — change outside all components", () => {
    const result = verifyCapabilities(
      manifest,
      { writes: ["auth"] },
      ["/project/src/auth/middleware.ts", "/project/package.json"],
    );
    expect(result.valid).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].actual_component).toBe("outside all components");
  });

  test("no violations when no writes declared and no changes", () => {
    const result = verifyCapabilities(manifest, { reads: ["auth"] }, []);
    expect(result.valid).toBe(true);
  });
});
