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
          docs: {
            interface: resolve(PROJECT_ROOT, "docs/core/interface.md"),
            internal: resolve(PROJECT_ROOT, "docs/core/internal.md"),
          },
        },
      },
    };

    const report = checkFreshness(manifest);
    expect(report.components.core).toBeDefined();
    expect(report.components.core.interface_doc.path).toContain("interface.md");
    // Source files were just created, so docs are likely stale
    expect(typeof report.components.core.interface_doc.stale).toBe("boolean");
  });

  test("handles missing doc files gracefully", () => {
    const manifest = {
      varp: "0.1.0",
      name: "test",
      components: {
        missing: {
          path: "/nonexistent/path",
          docs: {
            interface: "/nonexistent/interface.md",
            internal: "/nonexistent/internal.md",
          },
        },
      },
    };

    const report = checkFreshness(manifest);
    expect(report.components.missing.interface_doc.last_modified).toBe("N/A");
    expect(report.components.missing.interface_doc.stale).toBe(true);
    expect(report.components.missing.source_last_modified).toBe("N/A");
  });
});
