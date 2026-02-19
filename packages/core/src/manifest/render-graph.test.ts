import { describe, test, expect } from "bun:test";

import type { Manifest } from "#shared/types.js";

import { renderAsciiGraph, renderGraph, renderTagGroups } from "./render-graph.js";

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

describe("renderAsciiGraph", () => {
  test("renders linear chain correctly", () => {
    const linear: Manifest = {
      varp: "0.1.0",
      components: {
        a: { path: "a", docs: [] },
        b: { path: "b", deps: ["a"], docs: [] },
        c: { path: "c", deps: ["b"], docs: [] },
      },
    };
    const result = renderAsciiGraph(linear, { tags: false });
    const resultLines = result.split("\n");
    expect(resultLines[0]).toBe("a");
    expect(resultLines[1]).toContain("b");
    expect(resultLines[2]).toContain("c");
  });

  test("handles diamond dependency", () => {
    const diamond: Manifest = {
      varp: "0.1.0",
      components: {
        root: { path: "root", docs: [] },
        left: { path: "left", deps: ["root"], docs: [] },
        right: { path: "right", deps: ["root"], docs: [] },
        bottom: { path: "bottom", deps: ["left", "right"], docs: [] },
      },
    };
    const result = renderAsciiGraph(diamond, { tags: false });
    const lines = result.split("\n");
    const parentLine = lines.find(
      (l) => l.includes("left") && l.includes("right") && !l.includes("──"),
    );
    expect(parentLine).toBeDefined();
  });

  test("renders disconnected subgraphs", () => {
    const disconnected: Manifest = {
      varp: "0.1.0",
      components: {
        a: { path: "a", docs: [] },
        b: { path: "b", deps: ["a"], docs: [] },
        x: { path: "x", docs: [] },
        y: { path: "y", deps: ["x"], docs: [] },
      },
    };
    const result = renderAsciiGraph(disconnected, { tags: false });
    expect(result).toContain("a");
    expect(result).toContain("b");
    expect(result).toContain("x");
    expect(result).toContain("y");
  });

  test("renders stability badges by default", () => {
    const result = renderAsciiGraph(manifest, { tags: false });
    expect(result).toContain("auth ·");
    expect(result).toContain("api ·▲");
    expect(result).toContain("web ·⚠");
    const sharedLine = result.split("\n").find((l) => l.startsWith("shared"));
    expect(sharedLine).toBe("shared");
  });

  test("hides stability badges when disabled", () => {
    const result = renderAsciiGraph(manifest, { tags: false, stability: false });
    expect(result).not.toContain("·");
    expect(result).not.toContain("·▲");
    expect(result).not.toContain("·⚠");
  });

  test("renders flat list for no-deps manifest", () => {
    const flat: Manifest = {
      varp: "0.1.0",
      components: {
        alpha: { path: "a", docs: [] },
        beta: { path: "b", docs: [] },
        gamma: { path: "c", docs: [] },
      },
    };
    const result = renderAsciiGraph(flat, { tags: false });
    expect(result).toBe("alpha\nbeta\ngamma");
  });

  test("returns empty string for empty manifest", () => {
    const empty: Manifest = { varp: "0.1.0", components: {} };
    expect(renderAsciiGraph(empty)).toBe("");
  });

  test("renders superscript tag markers with legend", () => {
    const tagged: Manifest = {
      varp: "0.1.0",
      components: {
        a: { path: "a", tags: ["core", "infra"], docs: [] },
        b: { path: "b", tags: ["core"], docs: [] },
        c: { path: "c", docs: [] },
      },
    };
    const result = renderAsciiGraph(tagged, { tags: "superscript", stability: false });
    // a has tags core(¹) and infra(²)
    expect(result).toContain("a ¹²");
    expect(result).toContain("b ¹");
    // c has no tags — no superscripts
    const cLine = result.split("\n").find((l) => l === "c");
    expect(cLine).toBeDefined();
    // Legend at bottom
    expect(result).toContain("¹ core");
    expect(result).toContain("² infra");
  });

  test("renders colored tag markers with legend", () => {
    const tagged: Manifest = {
      varp: "0.1.0",
      components: {
        a: { path: "a", tags: ["core"], docs: [] },
      },
    };
    const result = renderAsciiGraph(tagged, { tags: "color", stability: false });
    // Should contain ANSI escape + ● + reset
    expect(result).toContain("●");
    expect(result).toContain("\x1b[");
    // Legend
    expect(result).toContain("core");
  });

  test("no legend when no tags exist", () => {
    const result = renderAsciiGraph(manifest, { tags: "superscript" });
    // manifest has no tags — no legend appended
    expect(result).not.toContain("¹");
  });

  test("combines stability and tags", () => {
    const tagged: Manifest = {
      varp: "0.1.0",
      components: {
        a: { path: "a", stability: "stable", tags: ["core"], docs: [] },
      },
    };
    const result = renderAsciiGraph(tagged, { tags: "superscript" });
    // Should have both stability badge and tag superscript
    expect(result).toContain("a · ¹");
  });
});

describe("renderTagGroups", () => {
  test("groups components by tag", () => {
    const tagged: Manifest = {
      varp: "0.1.0",
      components: {
        a: { path: "a", tags: ["core", "infra"], docs: [] },
        b: { path: "b", tags: ["core"], docs: [] },
        c: { path: "c", tags: ["infra"], docs: [] },
      },
    };
    const result = renderTagGroups(tagged);
    expect(result).toContain("[core] a, b");
    expect(result).toContain("[infra] a, c");
  });

  test("shows untagged components", () => {
    const mixed: Manifest = {
      varp: "0.1.0",
      components: {
        a: { path: "a", tags: ["core"], docs: [] },
        b: { path: "b", docs: [] },
      },
    };
    const result = renderTagGroups(mixed);
    expect(result).toContain("[core] a");
    expect(result).toContain("[untagged] b");
  });

  test("returns empty for manifest with no tags", () => {
    const result = renderTagGroups(manifest);
    // All components untagged
    expect(result).toContain("[untagged]");
    expect(result).not.toContain("[core]");
  });
});
