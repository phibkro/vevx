import { describe, test, expect } from "bun:test";
import { checkFreshness } from "./freshness.js";
import { resolve } from "node:path";

const PROJECT_ROOT = resolve(import.meta.dir, "../..");

describe("checkFreshness", () => {
  test("checks freshness of project's own manifest", () => {
    const manifest = {
      varp: "0.1.0",
      name: "varp",
      components: {
        core: {
          path: resolve(PROJECT_ROOT, "src"),
          docs: [
            { name: "interface", path: resolve(PROJECT_ROOT, "docs/core/interface.md"), load_on: ["reads" as const] },
            { name: "internal", path: resolve(PROJECT_ROOT, "docs/core/internal.md"), load_on: ["writes" as const] },
          ],
        },
      },
    };

    const report = checkFreshness(manifest);
    expect(report.components.core).toBeDefined();
    expect(report.components.core.docs["interface"].path).toContain("interface.md");
    expect(typeof report.components.core.docs["interface"].stale).toBe("boolean");
  });

  test("handles missing doc files gracefully", () => {
    const manifest = {
      varp: "0.1.0",
      name: "test",
      components: {
        missing: {
          path: "/nonexistent/path",
          docs: [
            { name: "interface", path: "/nonexistent/interface.md", load_on: ["reads" as const] },
            { name: "internal", path: "/nonexistent/internal.md", load_on: ["writes" as const] },
          ],
        },
      },
    };

    const report = checkFreshness(manifest);
    expect(report.components.missing.docs["interface"].last_modified).toBe("N/A");
    expect(report.components.missing.docs["interface"].stale).toBe(true);
    expect(report.components.missing.source_last_modified).toBe("N/A");
  });

  test("reports project-level docs freshness", () => {
    const manifest = {
      varp: "0.1.0",
      name: "test",
      docs: {
        readme: {
          name: "readme",
          path: resolve(PROJECT_ROOT, "README.md"),
          load_on: ["reads" as const],
        },
      },
      components: {
        core: {
          path: resolve(PROJECT_ROOT, "src"),
          docs: [],
        },
      },
    };

    const report = checkFreshness(manifest);
    expect(report.project_docs).toBeDefined();
    expect(report.project_docs!["readme"].path).toContain("README.md");
  });
});
