import { describe, expect, it } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";

import { VarpConfigSchema, loadConfig, toFilterConfig } from "./config.js";
// Backward compat aliases
import { AnalysisConfigSchema, loadAnalysisConfig } from "./config.js";

describe("VarpConfigSchema", () => {
  it("provides full defaults when parsing empty object", () => {
    const config = VarpConfigSchema.parse({});
    expect(config.cochange.commit_size_ceiling).toBe(50);
    expect(config.cochange.message_excludes).toContain("merge");
    expect(config.cochange.file_excludes).toContain("**/bun.lock");
    expect(config.cochange.type_multipliers).toBeUndefined();
    expect(config.hotspots.max_commits).toBe(500);
    expect(config.hotspots.trend_threshold).toBe(1);
    expect(config.hotspots.trend_min_commits).toBe(2);
    expect(config.freshness.staleness_threshold_ms).toBe(5000);
  });

  it("allows sparse overrides", () => {
    const config = VarpConfigSchema.parse({
      cochange: { commit_size_ceiling: 30 },
    });
    expect(config.cochange.commit_size_ceiling).toBe(30);
    expect(config.cochange.message_excludes).toContain("merge");
    expect(config.hotspots.max_commits).toBe(500);
  });

  it("accepts conventional commit type multipliers", () => {
    const config = VarpConfigSchema.parse({
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

  it("exports deprecated aliases", () => {
    expect(AnalysisConfigSchema).toBe(VarpConfigSchema);
    expect(loadAnalysisConfig).toBe(loadConfig);
  });
});

describe("loadConfig", () => {
  it("returns defaults when no config file exists", () => {
    const config = loadConfig("/nonexistent/path");
    expect(config.cochange.commit_size_ceiling).toBe(50);
    expect(config.hotspots.max_commits).toBe(500);
  });

  it("loads and merges config from .varp/config.json", () => {
    const dir = `${process.env.TMPDIR ?? "/tmp/claude"}/varp-config-test-${Date.now()}`;
    mkdirSync(`${dir}/.varp`, { recursive: true });
    writeFileSync(
      `${dir}/.varp/config.json`,
      JSON.stringify({ cochange: { commit_size_ceiling: 25 } }),
    );

    const config = loadConfig(dir);
    expect(config.cochange.commit_size_ceiling).toBe(25);
    expect(config.cochange.message_excludes).toContain("merge");
  });
});

describe("toFilterConfig", () => {
  it("maps config to FilterConfig shape", () => {
    const config = VarpConfigSchema.parse({ cochange: { commit_size_ceiling: 30 } });
    const filter = toFilterConfig(config);
    expect(filter.max_commit_files).toBe(30);
    expect(filter.skip_message_patterns).toContain("merge");
    expect(filter.exclude_paths).toContain("**/bun.lock");
  });
});
