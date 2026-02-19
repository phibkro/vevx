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
