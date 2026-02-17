import { describe, test, expect } from "bun:test";
import { discoverDocs } from "./discovery.js";
import { resolve } from "node:path";

const PROJECT_ROOT = resolve(import.meta.dir, "../..");

describe("discoverDocs", () => {
  test("discovers README.md at component root", () => {
    // src/README.md exists
    const docs = discoverDocs({
      path: resolve(PROJECT_ROOT, "src"),
      docs: [],
    });
    expect(docs).toContain(resolve(PROJECT_ROOT, "src/README.md"));
  });

  test("discovers docs/*.md as private docs", () => {
    // src/docs/ contains architecture.md and others
    const docs = discoverDocs({
      path: resolve(PROJECT_ROOT, "src"),
      docs: [],
    });
    expect(docs.some((d) => d.endsWith("architecture.md"))).toBe(true);
    expect(docs.some((d) => d.endsWith("design-principles.md"))).toBe(true);
  });

  test("does not duplicate explicitly listed docs", () => {
    const archPath = resolve(PROJECT_ROOT, "src/docs/architecture.md");
    const docs = discoverDocs({
      path: resolve(PROJECT_ROOT, "src"),
      docs: [archPath],
    });
    const archCount = docs.filter((d) => d === archPath).length;
    expect(archCount).toBe(1);
  });

  test("handles component with no README or docs dir", () => {
    const docs = discoverDocs({
      path: "/nonexistent/path",
      docs: [],
    });
    expect(docs).toHaveLength(0);
  });

  test("preserves explicit docs alongside auto-discovered", () => {
    const explicit = "/some/explicit/doc.md";
    const docs = discoverDocs({
      path: resolve(PROJECT_ROOT, "src"),
      docs: [explicit],
    });
    expect(docs).toContain(explicit);
    expect(docs.some((d) => d.endsWith("README.md"))).toBe(true);
  });
});
