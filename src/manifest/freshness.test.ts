import { describe, test, expect } from "bun:test";
import { checkFreshness } from "./freshness.js";
import { resolve } from "node:path";

const PROJECT_ROOT = resolve(import.meta.dir, "../..");

describe("checkFreshness", () => {
  test("checks freshness of project's own manifest", () => {
    const manifest = {
      varp: "0.1.0",
      components: {
        core: {
          path: resolve(PROJECT_ROOT, "src"),
          docs: [
            resolve(PROJECT_ROOT, "docs/core/README.md"),
            resolve(PROJECT_ROOT, "docs/core/internal.md"),
          ],
        },
      },
    };

    const report = checkFreshness(manifest);
    expect(report.components.core).toBeDefined();
    expect(report.components.core.docs["README"].path).toContain("README.md");
    expect(typeof report.components.core.docs["README"].stale).toBe("boolean");
  });

  test("handles missing doc files gracefully", () => {
    const manifest = {
      varp: "0.1.0",
      components: {
        missing: {
          path: "/nonexistent/path",
          docs: [
            "/nonexistent/README.md",
            "/nonexistent/internal.md",
          ],
        },
      },
    };

    const report = checkFreshness(manifest);
    expect(report.components.missing.docs["README"].last_modified).toBe("N/A");
    expect(report.components.missing.docs["README"].stale).toBe(true);
    expect(report.components.missing.source_last_modified).toBe("N/A");
  });
});
