import { describe, test, expect } from "bun:test";
import { resolveDocs } from "./resolver.js";
import type { Manifest } from "../types.js";

const manifest: Manifest = {
  varp: "0.1.0",
  name: "test",
  components: {
    auth: {
      path: "/src/auth",
      docs: {
        interface: "/docs/auth/interface.md",
        internal: "/docs/auth/internal.md",
      },
    },
    api: {
      path: "/src/api",
      depends_on: ["auth"],
      docs: {
        interface: "/docs/api/interface.md",
        internal: "/docs/api/internal.md",
      },
    },
  },
};

describe("resolveDocs", () => {
  test("writes get both interface and internal", () => {
    const result = resolveDocs(manifest, { writes: ["auth"] });
    expect(result.interface_docs).toContainEqual({
      component: "auth",
      path: "/docs/auth/interface.md",
    });
    expect(result.internal_docs).toContainEqual({
      component: "auth",
      path: "/docs/auth/internal.md",
    });
  });

  test("reads get interface only", () => {
    const result = resolveDocs(manifest, { reads: ["api"] });
    expect(result.interface_docs).toContainEqual({
      component: "api",
      path: "/docs/api/interface.md",
    });
    expect(result.internal_docs).toHaveLength(0);
  });

  test("mixed reads and writes", () => {
    const result = resolveDocs(manifest, {
      writes: ["auth"],
      reads: ["api"],
    });
    expect(result.interface_docs).toHaveLength(2);
    expect(result.internal_docs).toHaveLength(1);
    expect(result.internal_docs[0].component).toBe("auth");
  });

  test("throws on unknown component", () => {
    expect(() => resolveDocs(manifest, { reads: ["nonexistent"] })).toThrow(
      "Unknown component: nonexistent",
    );
  });

  test("component in both reads and writes gets internal docs", () => {
    const result = resolveDocs(manifest, {
      writes: ["auth"],
      reads: ["auth"],
    });
    expect(result.interface_docs).toHaveLength(1); // deduplicated
    expect(result.internal_docs).toHaveLength(1);
  });
});
