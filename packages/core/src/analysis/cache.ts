import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

import type { CoChangeGraph, FilterConfig } from "#shared/types.js";
import { FilterConfigSchema } from "#shared/types.js";

import { scanCoChanges } from "./co-change.js";

// ── Cache schema ──

const CoChangeCacheSchema = z.object({
  last_sha: z.string(),
  filter_config: FilterConfigSchema,
  edges: z.record(z.string(), z.object({ weight: z.number(), count: z.number() })),
});

type CoChangeCache = z.infer<typeof CoChangeCacheSchema>;

// ── Pure functions ──

/**
 * Determine cache strategy based on current state.
 * - "current": cache is fresh (same HEAD, same config) — no work needed
 * - "incremental": new commits exist — scan only new commits, merge
 * - "full": cache missing, invalid, or config changed — full rescan
 */
export function cacheStrategy(
  cache: CoChangeCache | null,
  currentHead: string,
  config: FilterConfig,
): "full" | "incremental" | "current" {
  if (!cache) return "full";

  // Config changed → full recompute
  if (
    cache.filter_config.max_commit_files !== config.max_commit_files ||
    JSON.stringify(cache.filter_config.skip_message_patterns) !==
      JSON.stringify(config.skip_message_patterns) ||
    JSON.stringify(cache.filter_config.exclude_paths) !== JSON.stringify(config.exclude_paths)
  ) {
    return "full";
  }

  if (cache.last_sha === currentHead) return "current";
  return "incremental";
}

/**
 * Merge incremental edges into existing edge map. Weights and counts are additive.
 */
export function mergeEdges(
  existing: Record<string, { weight: number; count: number }>,
  incremental: CoChangeGraph,
): Record<string, { weight: number; count: number }> {
  const merged = { ...existing };

  for (const edge of incremental.edges) {
    const key = `${edge.files[0]}\0${edge.files[1]}`;
    const prev = merged[key];
    if (prev) {
      merged[key] = { weight: prev.weight + edge.weight, count: prev.count + edge.commit_count };
    } else {
      merged[key] = { weight: edge.weight, count: edge.commit_count };
    }
  }

  return merged;
}

/**
 * Convert edge record to CoChangeGraph edges array.
 */
function edgesToArray(
  edges: Record<string, { weight: number; count: number }>,
): CoChangeGraph["edges"] {
  return Object.entries(edges).map(([key, { weight, count }]) => {
    const [a, b] = key.split("\0") as [string, string];
    return { files: [a, b], weight, commit_count: count };
  });
}

// ── Effectful functions ──

const CACHE_FILE = "co-change.json";

/**
 * Read cache from .varp/ directory. Returns null if missing or invalid.
 */
export function readCache(varpDir: string): CoChangeCache | null {
  const path = join(varpDir, CACHE_FILE);
  if (!existsSync(path)) return null;

  try {
    const raw = JSON.parse(readFileSync(path, "utf-8"));
    return CoChangeCacheSchema.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Write cache to .varp/ directory. Creates directory if needed.
 */
export function writeCache(varpDir: string, cache: CoChangeCache): void {
  mkdirSync(varpDir, { recursive: true });
  writeFileSync(join(varpDir, CACHE_FILE), JSON.stringify(cache, null, 2));
}

/**
 * Get current HEAD sha from git.
 */
function getCurrentHead(repoDir: string): string {
  const result = Bun.spawnSync(["git", "rev-parse", "HEAD"], {
    cwd: repoDir,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (!result.success) throw new Error("git rev-parse HEAD failed");
  return result.stdout.toString().trim();
}

/**
 * Orchestrate cached co-change scanning:
 * cache read → strategy → scan → cache write → return graph.
 */
export function scanCoChangesWithCache(
  repoDir: string,
  config?: Partial<FilterConfig>,
): CoChangeGraph {
  const resolvedConfig = FilterConfigSchema.parse(config ?? {});
  const varpDir = join(repoDir, ".varp");
  const cache = readCache(varpDir);
  const currentHead = getCurrentHead(repoDir);
  const strategy = cacheStrategy(cache, currentHead, resolvedConfig);

  if (strategy === "current" && cache) {
    return {
      edges: edgesToArray(cache.edges),
      total_commits_analyzed: 0,
      total_commits_filtered: 0,
      last_sha: cache.last_sha,
    };
  }

  if (strategy === "incremental" && cache) {
    const incremental = scanCoChanges(repoDir, config, cache.last_sha);
    const merged = mergeEdges(cache.edges, incremental);
    const newCache: CoChangeCache = {
      last_sha: currentHead,
      filter_config: resolvedConfig,
      edges: merged,
    };
    writeCache(varpDir, newCache);
    return {
      edges: edgesToArray(merged),
      total_commits_analyzed: incremental.total_commits_analyzed,
      total_commits_filtered: incremental.total_commits_filtered,
      last_sha: currentHead,
    };
  }

  // Full scan
  const graph = scanCoChanges(repoDir, config);
  const edgeRecord: Record<string, { weight: number; count: number }> = {};
  for (const edge of graph.edges) {
    edgeRecord[`${edge.files[0]}\0${edge.files[1]}`] = {
      weight: edge.weight,
      count: edge.commit_count,
    };
  }
  const newCache: CoChangeCache = {
    last_sha: currentHead,
    filter_config: resolvedConfig,
    edges: edgeRecord,
  };
  writeCache(varpDir, newCache);
  return { ...graph, last_sha: currentHead };
}
