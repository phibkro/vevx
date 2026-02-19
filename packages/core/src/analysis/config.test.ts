import { describe, expect, it } from "bun:test";

import { AnalysisConfigSchema } from "./config.js";

describe("AnalysisConfigSchema", () => {
  it("provides full defaults when parsing empty object", () => {
    const config = AnalysisConfigSchema.parse({});
    expect(config.cochange.commit_size_ceiling).toBe(50);
    expect(config.cochange.message_excludes).toContain("merge");
    expect(config.cochange.file_excludes).toContain("**/bun.lock");
    expect(config.cochange.type_multipliers).toBeUndefined();
    expect(config.hotspots.max_commits).toBe(500);
    expect(config.hotspots.trend_threshold).toBe(1);
  });

  it("allows sparse overrides", () => {
    const config = AnalysisConfigSchema.parse({
      cochange: { commit_size_ceiling: 30 },
    });
    expect(config.cochange.commit_size_ceiling).toBe(30);
    expect(config.cochange.message_excludes).toContain("merge");
    expect(config.hotspots.max_commits).toBe(500);
  });

  it("accepts conventional commit type multipliers", () => {
    const config = AnalysisConfigSchema.parse({
      cochange: {
        type_multipliers: { feat: 1.0, fix: 1.0, chore: 0.2 },
      },
    });
    expect(config.cochange.type_multipliers).toEqual({
      feat: 1.0,
      fix: 1.0,
      chore: 0.2,
    });
  });
});
