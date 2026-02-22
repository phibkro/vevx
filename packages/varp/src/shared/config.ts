import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

import type { FilterConfig } from "./types.js";

// ── Section schemas ──

export const CoChangeConfigSchema = z.object({
  commit_size_ceiling: z.number().int().positive().default(50),
  message_excludes: z
    .array(z.string())
    .default(["chore", "style", "format", "lint", "merge", "rebase"]),
  file_excludes: z
    .array(z.string())
    .default(["**/package-lock.json", "**/bun.lock", "**/bun.lockb", "**/*.d.ts", "**/.varp/**"]),
  type_multipliers: z.record(z.string(), z.number().min(0).max(2)).optional(),
});

export const HotspotsConfigSchema = z.object({
  max_commits: z.number().int().positive().default(500),
  trend_threshold: z.number().nonnegative().default(1),
  trend_min_commits: z.number().int().positive().default(2),
});

export const FreshnessConfigSchema = z.object({
  staleness_threshold_ms: z.number().int().positive().default(5000),
});

// ── Root schema ──
// NOTE: If this grows beyond analysis + freshness (e.g. lint tuning, execution
// defaults), evaluate extracting to a dedicated `config` component.

export const VarpConfigSchema = z.object({
  cochange: CoChangeConfigSchema.default({}),
  hotspots: HotspotsConfigSchema.default({}),
  freshness: FreshnessConfigSchema.default({}),
});

export type VarpConfig = z.infer<typeof VarpConfigSchema>;

/** @deprecated Use VarpConfigSchema */
export const AnalysisConfigSchema = VarpConfigSchema;
/** @deprecated Use VarpConfig */
export type AnalysisConfig = VarpConfig;

const CONFIG_PATH = ".varp/config.json";

/**
 * Load project config from `.varp/config.json` in the given directory.
 * Returns full defaults if the file doesn't exist.
 */
export function loadConfig(repoDir: string): VarpConfig {
  const configPath = join(repoDir, CONFIG_PATH);
  if (!existsSync(configPath)) {
    return VarpConfigSchema.parse({});
  }
  const raw = JSON.parse(readFileSync(configPath, "utf-8"));
  return VarpConfigSchema.parse(raw);
}

/** @deprecated Use loadConfig */
export const loadAnalysisConfig = loadConfig;

/**
 * Bridge: convert VarpConfig's cochange section to FilterConfig shape.
 * Lets existing functions accept FilterConfig without signature changes.
 */
export function toFilterConfig(config: VarpConfig): FilterConfig {
  return {
    max_commit_files: config.cochange.commit_size_ceiling,
    skip_message_patterns: config.cochange.message_excludes,
    exclude_paths: config.cochange.file_excludes,
  };
}
