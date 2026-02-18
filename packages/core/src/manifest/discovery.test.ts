import { describe, test, expect } from "bun:test";
import { resolve } from "node:path";

import { discoverDocs } from "./discovery.js";

const PROJECT_ROOT = resolve(import.meta.dir, "../..");

describe("discoverDocs", () => {
  test("discovers README.md via src collapse", () => {
    // path is packages/core/src, README.md is at packages/core/README.md (parent)
    const docs = discoverDocs({
      path: resolve(PROJECT_ROOT, "src"),
      docs: [],
    });
    expect(docs).toContain(resolve(PROJECT_ROOT, "README.md"));
  });

  test("discovers docs/*.md as private docs", () => {
    // src/docs/ contains architecture.md
    const docs = discoverDocs({
      path: resolve(PROJECT_ROOT, "src"),
      docs: [],
    });
    expect(docs.some((d) => d.endsWith("architecture.md"))).toBe(true);
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

  test("src collapse: path ending in src/ discovers docs from parent", () => {
    // packages/core has path ./src but README.md is at packages/core/README.md (not src/README.md)
    // Use the audit package: path is packages/audit/src, README at packages/audit/README.md
    const auditRoot = resolve(PROJECT_ROOT, "../../packages/audit");
    const docs = discoverDocs({
      path: resolve(auditRoot, "src"),
      docs: [],
    });
    // Should find README.md from parent (packages/audit/README.md)
    expect(docs).toContain(resolve(auditRoot, "README.md"));
  });

  test("src collapse: path without src/ also scans src/ child", () => {
    // packages/audit/ has src/ child dir, README only at root level
    const auditRoot = resolve(PROJECT_ROOT, "../../packages/audit");
    const docs = discoverDocs({
      path: auditRoot,
      docs: [],
    });
    // Should find README.md at packages/audit/README.md
    expect(docs).toContain(resolve(auditRoot, "README.md"));
    // Verify src/ child is scanned (no crash, no duplicates)
    const unique = new Set(docs);
    expect(unique.size).toBe(docs.length);
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
