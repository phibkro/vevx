import { describe, test, expect } from "bun:test";
import { resolveDocs } from "./resolver.js";
import type { Manifest } from "../types.js";

const manifest: Manifest = {
  varp: "0.1.0",
  components: {
    auth: {
      path: "/src/auth",
      docs: [
        "/docs/auth/README.md",
        "/docs/auth/internal.md",
      ],
    },
    api: {
      path: "/src/api",
      deps: ["auth"],
      docs: [
        "/docs/api/README.md",
        "/docs/api/internal.md",
        "/docs/api/examples.md",
      ],
    },
  },
};

describe("resolveDocs", () => {
  test("writes get all docs (README + private)", () => {
    const result = resolveDocs(manifest, { writes: ["auth"] });
    const names = result.docs.map((d) => d.doc);
    expect(names).toContain("README");
    expect(names).toContain("internal");
  });

  test("reads get only README.md docs (public)", () => {
    const result = resolveDocs(manifest, { reads: ["auth"] });
    const names = result.docs.map((d) => d.doc);
    expect(names).toContain("README");
    expect(names).not.toContain("internal");
  });

  test("mixed reads and writes", () => {
    const result = resolveDocs(manifest, {
      writes: ["auth"],
      reads: ["api"],
    });
    // auth writes: README + internal = 2
    // api reads: README only = 1
    expect(result.docs).toHaveLength(3);
  });

  test("throws on unknown component", () => {
    expect(() => resolveDocs(manifest, { reads: ["nonexistent"] })).toThrow(
      "Unknown component: nonexistent",
    );
  });

  test("component in both reads and writes deduplicates", () => {
    const result = resolveDocs(manifest, {
      writes: ["auth"],
      reads: ["auth"],
    });
    // README + internal, each once
    expect(result.docs).toHaveLength(2);
  });

  test("reads get README.md docs but not private docs", () => {
    const result = resolveDocs(manifest, { reads: ["api"] });
    const names = result.docs.map((d) => d.doc);
    expect(names).toContain("README");
    expect(names).not.toContain("internal");
    expect(names).not.toContain("examples");
  });

  test("writes get all docs including private", () => {
    const result = resolveDocs(manifest, { writes: ["api"] });
    const names = result.docs.map((d) => d.doc);
    expect(names).toContain("README");
    expect(names).toContain("internal");
    expect(names).toContain("examples");
  });
});
