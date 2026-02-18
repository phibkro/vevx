import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, utimesSync } from "node:fs";
import { join, resolve } from "node:path";

import { checkFreshness, checkWarmStaleness, computeStaleness } from "./freshness.js";

const PROJECT_ROOT = resolve(import.meta.dir, "../..");
const TMP_DIR = join(PROJECT_ROOT, "test-fixtures", "freshness-tmp");

describe("checkFreshness", () => {
  test("auto-discovers docs from component path", () => {
    const manifest = {
      varp: "0.1.0",
      components: {
        core: {
          path: resolve(PROJECT_ROOT, "src"),
          docs: [],
        },
      },
    };

    const report = checkFreshness(manifest);
    expect(report.components.core).toBeDefined();
    // README.md auto-discovered via src collapse (lives at parent)
    expect(report.components.core.docs["README"]).toBeDefined();
    expect(report.components.core.docs["README"].path).toContain("README.md");
    // docs/*.md auto-discovered via src collapse — keyed by basename (outside component path)
    expect(report.components.core.docs["architecture"]).toBeDefined();
    expect(typeof report.components.core.docs["architecture"].stale).toBe("boolean");
  });

  test("handles missing doc files gracefully", () => {
    const manifest = {
      varp: "0.1.0",
      components: {
        missing: {
          path: "/nonexistent/path",
          docs: ["/nonexistent/README.md", "/nonexistent/internal.md"],
        },
      },
    };

    const report = checkFreshness(manifest);
    expect(report.components.missing.docs["README"].last_modified).toBe("N/A");
    expect(report.components.missing.docs["README"].stale).toBe(true);
    expect(report.components.missing.source_last_modified).toBe("N/A");
  });

  describe("mtime race fix", () => {
    beforeAll(() => {
      // Create structure:
      //   freshness-tmp/comp/
      //     source.ts      — mtime: Jan 1 2026
      //     README.md      — mtime: Feb 1 2026 (newer than source!)
      mkdirSync(join(TMP_DIR, "comp"), { recursive: true });
      writeFileSync(join(TMP_DIR, "comp/source.ts"), "export const x = 1;");
      writeFileSync(join(TMP_DIR, "comp/README.md"), "# Docs");
      // Set source to Jan 1 2026
      const sourceTime = new Date("2026-01-01T00:00:00Z");
      utimesSync(join(TMP_DIR, "comp/source.ts"), sourceTime, sourceTime);
      // Set doc to Feb 1 2026 (newer)
      const docTime = new Date("2026-02-01T00:00:00Z");
      utimesSync(join(TMP_DIR, "comp/README.md"), docTime, docTime);
    });

    afterAll(() => {
      try {
        rmSync(TMP_DIR, { recursive: true });
      } catch {}
    });

    test("doc file mtime does not inflate source_last_modified", () => {
      const manifest = {
        varp: "0.1.0",
        components: {
          comp: { path: join(TMP_DIR, "comp"), docs: [] },
        },
      };

      const report = checkFreshness(manifest);
      // source_last_modified should reflect source.ts (Jan 1), not README.md (Feb 1)
      const sourceMtime = new Date(report.components.comp.source_last_modified);
      expect(sourceMtime.getTime()).toBe(new Date("2026-01-01T00:00:00Z").getTime());
      // README should NOT be stale since doc (Feb 1) > source (Jan 1)
      expect(report.components.comp.docs["README"].stale).toBe(false);
    });
  });

  describe("test file exclusion", () => {
    const TEST_EXCL_TMP = join(PROJECT_ROOT, "test-fixtures", "test-excl-tmp");

    beforeAll(() => {
      // Create structure:
      //   comp/source.ts        — mtime: Jan 1 2026
      //   comp/source.test.ts   — mtime: Mar 1 2026 (newer, but should be ignored)
      //   comp/README.md        — mtime: Feb 1 2026
      mkdirSync(join(TEST_EXCL_TMP, "comp"), { recursive: true });
      writeFileSync(join(TEST_EXCL_TMP, "comp/source.ts"), "export const x = 1;");
      writeFileSync(join(TEST_EXCL_TMP, "comp/source.test.ts"), "test('x', () => {});");
      writeFileSync(join(TEST_EXCL_TMP, "comp/README.md"), "# Docs");
      const sourceTime = new Date("2026-01-01T00:00:00Z");
      utimesSync(join(TEST_EXCL_TMP, "comp/source.ts"), sourceTime, sourceTime);
      const testTime = new Date("2026-03-01T00:00:00Z");
      utimesSync(join(TEST_EXCL_TMP, "comp/source.test.ts"), testTime, testTime);
      const docTime = new Date("2026-02-01T00:00:00Z");
      utimesSync(join(TEST_EXCL_TMP, "comp/README.md"), docTime, docTime);
    });

    afterAll(() => {
      try {
        rmSync(TEST_EXCL_TMP, { recursive: true });
      } catch {}
    });

    test("test file mtime does not inflate source_last_modified", () => {
      const manifest = {
        varp: "0.1.0",
        components: {
          comp: { path: join(TEST_EXCL_TMP, "comp"), docs: [] },
        },
      };

      const report = checkFreshness(manifest);
      // source_last_modified should reflect source.ts (Jan 1), not source.test.ts (Mar 1)
      const sourceMtime = new Date(report.components.comp.source_last_modified);
      expect(sourceMtime.getTime()).toBe(new Date("2026-01-01T00:00:00Z").getTime());
      // README (Feb 1) > source (Jan 1), so not stale
      expect(report.components.comp.docs["README"].stale).toBe(false);
    });

    test("test file changes do not trigger warm staleness", () => {
      const manifest = {
        varp: "0.1.0",
        components: {
          comp: { path: join(TEST_EXCL_TMP, "comp"), docs: [] },
        },
      };

      // Baseline between source.ts (Jan 1) and source.test.ts (Mar 1)
      const since = new Date("2026-02-15T00:00:00Z");
      const result = checkWarmStaleness(manifest, ["comp"], since);
      expect(result.safe_to_resume).toBe(true);
      expect(result.stale_components).toEqual([]);
    });
  });

  describe("staleness threshold", () => {
    test("doc within 5s of source is not stale", () => {
      const source = new Date("2026-02-17T12:00:05.000Z");
      const doc = new Date("2026-02-17T12:00:02.000Z"); // 3s behind — within threshold
      const result = computeStaleness(source, [{ path: "/comp/README.md", mtime: doc }], "/comp");
      expect(result["README"].stale).toBe(false);
    });

    test("doc exactly 5s behind source is not stale", () => {
      const source = new Date("2026-02-17T12:00:05.000Z");
      const doc = new Date("2026-02-17T12:00:00.000Z"); // exactly 5s behind
      const result = computeStaleness(source, [{ path: "/comp/README.md", mtime: doc }], "/comp");
      expect(result["README"].stale).toBe(false);
    });

    test("doc more than 5s behind source is stale", () => {
      const source = new Date("2026-02-17T12:00:06.000Z");
      const doc = new Date("2026-02-17T12:00:00.000Z"); // 6s behind — beyond threshold
      const result = computeStaleness(source, [{ path: "/comp/README.md", mtime: doc }], "/comp");
      expect(result["README"].stale).toBe(true);
    });

    test("doc newer than source is not stale", () => {
      const source = new Date("2026-02-17T12:00:00.000Z");
      const doc = new Date("2026-02-17T12:00:10.000Z"); // 10s ahead
      const result = computeStaleness(source, [{ path: "/comp/README.md", mtime: doc }], "/comp");
      expect(result["README"].stale).toBe(false);
    });

    test("missing doc mtime is always stale", () => {
      const source = new Date("2026-02-17T12:00:00.000Z");
      const result = computeStaleness(source, [{ path: "/comp/README.md", mtime: null }], "/comp");
      expect(result["README"].stale).toBe(true);
    });
  });
});

describe("checkWarmStaleness", () => {
  const WARM_TMP = join(PROJECT_ROOT, "test-fixtures", "warm-staleness-tmp");

  beforeAll(() => {
    // Create two components:
    //   comp-a/source.ts — mtime: Jan 15 2026
    //   comp-b/source.ts — mtime: Feb 10 2026
    mkdirSync(join(WARM_TMP, "comp-a"), { recursive: true });
    mkdirSync(join(WARM_TMP, "comp-b"), { recursive: true });
    writeFileSync(join(WARM_TMP, "comp-a/source.ts"), "export const a = 1;");
    writeFileSync(join(WARM_TMP, "comp-b/source.ts"), "export const b = 1;");
    const timeA = new Date("2026-01-15T00:00:00Z");
    utimesSync(join(WARM_TMP, "comp-a/source.ts"), timeA, timeA);
    const timeB = new Date("2026-02-10T00:00:00Z");
    utimesSync(join(WARM_TMP, "comp-b/source.ts"), timeB, timeB);
  });

  afterAll(() => {
    try {
      rmSync(WARM_TMP, { recursive: true });
    } catch {}
  });

  const manifest = {
    varp: "0.1.0",
    components: {
      "comp-a": { path: join(WARM_TMP, "comp-a"), docs: [] },
      "comp-b": { path: join(WARM_TMP, "comp-b"), docs: [] },
    },
  };

  test("returns safe_to_resume when no components modified since baseline", () => {
    // Both components were modified before March 2026
    const since = new Date("2026-03-01T00:00:00Z");
    const result = checkWarmStaleness(manifest, ["comp-a", "comp-b"], since);
    expect(result.safe_to_resume).toBe(true);
    expect(result.stale_components).toEqual([]);
    expect(result.summary).toBe("No changes detected");
  });

  test("detects stale components modified after baseline", () => {
    // comp-a: Jan 15 (before baseline), comp-b: Feb 10 (after baseline)
    const since = new Date("2026-02-01T00:00:00Z");
    const result = checkWarmStaleness(manifest, ["comp-a", "comp-b"], since);
    expect(result.safe_to_resume).toBe(false);
    expect(result.stale_components).toHaveLength(1);
    expect(result.stale_components[0].component).toBe("comp-b");
    expect(result.summary).toContain("comp-b");
  });

  test("skips unknown components gracefully", () => {
    const since = new Date("2026-03-01T00:00:00Z");
    const result = checkWarmStaleness(manifest, ["comp-a", "nonexistent"], since);
    expect(result.safe_to_resume).toBe(true);
    expect(result.stale_components).toEqual([]);
  });

  test("reports multiple stale components", () => {
    const since = new Date("2026-01-01T00:00:00Z");
    const result = checkWarmStaleness(manifest, ["comp-a", "comp-b"], since);
    expect(result.safe_to_resume).toBe(false);
    expect(result.stale_components).toHaveLength(2);
    expect(result.summary).toContain("comp-a");
    expect(result.summary).toContain("comp-b");
  });
});
