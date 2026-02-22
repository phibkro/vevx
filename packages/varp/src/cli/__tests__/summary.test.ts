import { describe, expect, it } from "bun:test";
import { isAbsolute, resolve } from "path";

import { computeSummary, parseSummaryArgs } from "../summary.js";

// Use the repo's own varp.yaml as fixture
const MANIFEST = resolve(import.meta.dir, "../../../../../varp.yaml");

describe("computeSummary", () => {
  it("returns components with relative paths", () => {
    const summary = computeSummary(MANIFEST);
    expect(summary.components.length).toBeGreaterThan(0);
    for (const c of summary.components) {
      const paths = Array.isArray(c.path) ? c.path : [c.path];
      for (const p of paths) {
        expect(isAbsolute(p)).toBe(false);
      }
    }
  });

  it("freshness counts are consistent", () => {
    const summary = computeSummary(MANIFEST);
    expect(summary.stale_docs).toBeGreaterThanOrEqual(0);
    expect(summary.total_docs).toBeGreaterThanOrEqual(summary.stale_docs);
  });

  it("coupling hotspot pairs have two components", () => {
    const summary = computeSummary(MANIFEST);
    for (const h of summary.coupling_hotspots) {
      expect(h.pair).toHaveLength(2);
      expect(h.behavioral_weight).toBeGreaterThanOrEqual(0);
    }
  });

  it("caps hotspot file neighbors at 5 per file", () => {
    const summary = computeSummary(MANIFEST);
    for (const [, neighbors] of Object.entries(summary.hotspot_files)) {
      expect(neighbors.length).toBeLessThanOrEqual(5);
      for (const neighbor of neighbors) {
        expect(neighbor).toMatch(/\(\d+\.\d+\)$/);
      }
    }
  });
});

describe("parseSummaryArgs", () => {
  it("throws on invalid --format value", () => {
    expect(() => parseSummaryArgs(["--format", "xml"])).toThrow(/Invalid format/);
  });
});
