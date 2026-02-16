import { describe, test, expect } from "bun:test";
import { resolveDocs } from "./resolver.js";
import type { Manifest } from "../types.js";

const manifest: Manifest = {
  varp: "0.1.0",
  name: "test",
  components: {
    auth: {
      path: "/src/auth",
      docs: [
        { name: "interface", path: "/docs/auth/interface.md", load_on: ["reads"] },
        { name: "internal", path: "/docs/auth/internal.md", load_on: ["writes"] },
      ],
    },
    api: {
      path: "/src/api",
      depends_on: ["auth"],
      docs: [
        { name: "interface", path: "/docs/api/interface.md", load_on: ["reads"] },
        { name: "internal", path: "/docs/api/internal.md", load_on: ["writes"] },
        { name: "examples", path: "/docs/api/examples.md", load_on: ["reads", "writes"] },
      ],
    },
  },
};

describe("resolveDocs", () => {
  test("writes get docs tagged reads and writes", () => {
    const result = resolveDocs(manifest, { writes: ["auth"] });
    const names = result.docs.map((d) => d.doc_name);
    expect(names).toContain("interface");
    expect(names).toContain("internal");
  });

  test("reads get only docs tagged reads", () => {
    const result = resolveDocs(manifest, { reads: ["auth"] });
    const names = result.docs.map((d) => d.doc_name);
    expect(names).toContain("interface");
    expect(names).not.toContain("internal");
  });

  test("mixed reads and writes", () => {
    const result = resolveDocs(manifest, {
      writes: ["auth"],
      reads: ["api"],
    });
    // auth: interface (reads tag) + internal (writes tag) = 2
    // api: interface (reads tag) + examples (reads+writes tag, but only reads needed) = 2
    expect(result.docs).toHaveLength(4);
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
    // interface + internal, each once
    expect(result.docs).toHaveLength(2);
  });

  test("docs with both load_on tags load for reads", () => {
    const result = resolveDocs(manifest, { reads: ["api"] });
    const names = result.docs.map((d) => d.doc_name);
    expect(names).toContain("interface");
    expect(names).toContain("examples");
    expect(names).not.toContain("internal");
  });

  test("docs with both load_on tags load for writes", () => {
    const result = resolveDocs(manifest, { writes: ["api"] });
    const names = result.docs.map((d) => d.doc_name);
    expect(names).toContain("interface");
    expect(names).toContain("internal");
    expect(names).toContain("examples");
  });
});
