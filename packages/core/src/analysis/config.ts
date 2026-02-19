import type { FilterConfig } from "#shared/types.js";

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

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
});

export const AnalysisConfigSchema = z.object({
  cochange: CoChangeConfigSchema.default({}),
  hotspots: HotspotsConfigSchema.default({}),
});

export type AnalysisConfig = z.infer<typeof AnalysisConfigSchema>;

const CONFIG_PATH = ".varp/config.json";

/**
 * Load analysis config from `.varp/config.json` in the given directory.
 * Returns full defaults if the file doesn't exist.
 */
export function loadAnalysisConfig(repoDir: string): AnalysisConfig {
  const configPath = join(repoDir, CONFIG_PATH);
  if (!existsSync(configPath)) {
    return AnalysisConfigSchema.parse({});
  }
  const raw = JSON.parse(readFileSync(configPath, "utf-8"));
  return AnalysisConfigSchema.parse(raw);
}

/**
 * Bridge: convert AnalysisConfig's cochange section to FilterConfig shape.
 * Lets existing functions accept FilterConfig without signature changes.
 */
export function toFilterConfig(config: AnalysisConfig): FilterConfig {
  return {
    max_commit_files: config.cochange.commit_size_ceiling,
    skip_message_patterns: config.cochange.message_excludes,
    exclude_paths: config.cochange.file_excludes,
  };
}
