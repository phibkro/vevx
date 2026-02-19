import { describe, expect, it } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";

import { AnalysisConfigSchema, loadAnalysisConfig, toFilterConfig } from "./config.js";

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

describe("loadAnalysisConfig", () => {
  it("returns defaults when no config file exists", () => {
    const config = loadAnalysisConfig("/nonexistent/path");
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

    const config = loadAnalysisConfig(dir);
    expect(config.cochange.commit_size_ceiling).toBe(25);
    expect(config.cochange.message_excludes).toContain("merge");
  });
});

describe("toFilterConfig", () => {
  it("maps analysis config to FilterConfig shape", () => {
    const config = AnalysisConfigSchema.parse({ cochange: { commit_size_ceiling: 30 } });
    const filter = toFilterConfig(config);
    expect(filter.max_commit_files).toBe(30);
    expect(filter.skip_message_patterns).toContain("merge");
    expect(filter.exclude_paths).toContain("**/bun.lock");
  });
});
