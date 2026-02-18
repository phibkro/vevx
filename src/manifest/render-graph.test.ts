import { describe, test, expect } from "bun:test";

import type { Manifest } from "#shared/types.js";

import { renderGraph } from "./render-graph.js";

const manifest: Manifest = {
  varp: "0.1.0",
  components: {
    shared: { path: "src/shared", docs: [] },
    auth: { path: "src/auth", deps: ["shared"], stability: "stable", docs: [] },
    api: { path: "src/api", deps: ["shared", "auth"], stability: "active", docs: [] },
    web: { path: "src/web", deps: ["api"], stability: "experimental", docs: [] },
  },
};

describe("renderGraph", () => {
  test("renders Mermaid graph with default TD direction", () => {
    const result = renderGraph(manifest);
    expect(result).toStartWith("graph TD");
  });

  test("renders LR direction when specified", () => {
    const result = renderGraph(manifest, { direction: "LR" });
    expect(result).toStartWith("graph LR");
  });

  test("includes all component nodes", () => {
    const result = renderGraph(manifest);
    expect(result).toContain("shared");
    expect(result).toContain("auth");
    expect(result).toContain("api");
    expect(result).toContain("web");
  });

  test("includes dependency edges", () => {
    const result = renderGraph(manifest);
    expect(result).toContain("shared --> auth");
    expect(result).toContain("shared --> api");
    expect(result).toContain("auth --> api");
    expect(result).toContain("api --> web");
  });

  test("annotates nodes with stability badges", () => {
    const result = renderGraph(manifest);
    expect(result).toContain('auth["auth 🟢"]');
    expect(result).toContain('api["api 🟡"]');
    expect(result).toContain('web["web 🔴"]');
  });

  test("does not annotate nodes without stability", () => {
    const result = renderGraph(manifest);
    // shared has no stability — plain node, no brackets
    const sharedLines = result.split("\n").filter((l) => l.trim().startsWith("shared"));
    expect(sharedLines.some((l) => l.trim() === "shared")).toBe(true);
  });

  test("handles manifest with no deps", () => {
    const simple: Manifest = {
      varp: "0.1.0",
      components: {
        a: { path: "a", docs: [] },
        b: { path: "b", docs: [] },
      },
    };
    const result = renderGraph(simple);
    expect(result).toBe("graph TD\n  a\n  b");
  });
});
