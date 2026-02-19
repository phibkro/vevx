import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { CoChangeGraph, FilterConfig } from "#shared/types.js";

import { cacheStrategy, mergeEdges, readCache, writeCache } from "./cache.js";

const defaultConfig: FilterConfig = {
  max_commit_files: 50,
  skip_message_patterns: ["chore", "style", "format", "lint", "merge", "rebase"],
  exclude_paths: [
    "**/package-lock.json",
    "**/bun.lock",
    "**/bun.lockb",
    "**/*.d.ts",
    "**/.varp/**",
  ],
};

describe("cacheStrategy", () => {
  test("returns full when cache is null", () => {
    expect(cacheStrategy(null, "abc123", defaultConfig)).toBe("full");
  });

  test("returns current when HEAD matches and config unchanged", () => {
    const cache = { last_sha: "abc123", filter_config: defaultConfig, edges: {} };
    expect(cacheStrategy(cache, "abc123", defaultConfig)).toBe("current");
  });

  test("returns incremental when HEAD differs and config unchanged", () => {
    const cache = { last_sha: "abc123", filter_config: defaultConfig, edges: {} };
    expect(cacheStrategy(cache, "def456", defaultConfig)).toBe("incremental");
  });

  test("returns full when config changes", () => {
    const cache = { last_sha: "abc123", filter_config: defaultConfig, edges: {} };
    const newConfig = { ...defaultConfig, max_commit_files: 100 };
    expect(cacheStrategy(cache, "abc123", newConfig)).toBe("full");
  });
});

describe("mergeEdges", () => {
  test("merges new edges additively", () => {
    const existing = { "a.ts\0b.ts": { weight: 1.0, count: 2 } };
    const incremental: CoChangeGraph = {
      edges: [{ files: ["a.ts", "b.ts"], weight: 0.5, commit_count: 1 }],
      total_commits_analyzed: 1,
      total_commits_filtered: 0,
    };
    const merged = mergeEdges(existing, incremental);
    expect(merged["a.ts\0b.ts"]).toEqual({ weight: 1.5, count: 3 });
  });

  test("adds new edges that don't exist yet", () => {
    const existing = { "a.ts\0b.ts": { weight: 1.0, count: 1 } };
    const incremental: CoChangeGraph = {
      edges: [{ files: ["c.ts", "d.ts"], weight: 2.0, commit_count: 1 }],
      total_commits_analyzed: 1,
      total_commits_filtered: 0,
    };
    const merged = mergeEdges(existing, incremental);
    expect(Object.keys(merged)).toHaveLength(2);
    expect(merged["c.ts\0d.ts"]).toEqual({ weight: 2.0, count: 1 });
  });
});

describe("readCache / writeCache", () => {
  function withTempDir(fn: (dir: string) => void): void {
    const dir = join(
      "/tmp/claude",
      `cache-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(dir, { recursive: true });
    try {
      fn(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  test("round-trips cache data", () => {
    withTempDir((dir) => {
      const cache = {
        last_sha: "a".repeat(40),
        filter_config: defaultConfig,
        edges: { "x.ts\0y.ts": { weight: 1.5, count: 3 } },
      };
      writeCache(dir, cache);
      const loaded = readCache(dir);
      expect(loaded).not.toBeNull();
      expect(loaded!.last_sha).toBe(cache.last_sha);
      expect(loaded!.edges["x.ts\0y.ts"]).toEqual({ weight: 1.5, count: 3 });
    });
  });

  test("returns null for missing cache", () => {
    withTempDir((dir) => {
      expect(readCache(dir)).toBeNull();
    });
  });

  test("returns null for corrupt cache", () => {
    withTempDir((dir) => {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "co-change.json"), "not json");
      expect(readCache(dir)).toBeNull();
    });
  });
});
