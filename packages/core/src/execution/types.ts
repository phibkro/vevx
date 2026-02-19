import { z } from "zod";

/**
 * Result from a model call. Returned by ModelCaller implementations.
 */
export const ModelCallerResultSchema = z.object({
  /** The model's text response (or stringified structured output). */
  text: z.string(),
  /** Parsed structured output when jsonSchema was provided. */
  structured: z.unknown().optional(),
  /** Token usage from the API call. */
  usage: z
    .object({
      inputTokens: z.number(),
      outputTokens: z.number(),
    })
    .optional(),
  /** API cost in USD. */
  costUsd: z.number().optional(),
});

export type ModelCallerResult = z.infer<typeof ModelCallerResultSchema>;

/**
 * Backend-agnostic model caller.
 * The library defines the shape; consumers provide the implementation
 * (Claude Code CLI, Anthropic SDK, OpenAI, etc.).
 */
export type ModelCaller = (
  systemPrompt: string,
  userPrompt: string,
  options: { model: string; maxTokens?: number; jsonSchema?: Record<string, unknown> },
) => Promise<ModelCallerResult>;

// ── Task Result ──

export const TaskResultMetricsSchema = z.object({
  tokens_used: z.number(),
  duration_ms: z.number(),
  cost_usd: z.number().optional(),
});

export const TaskResultSchema = z.object({
  /** Exit status of the task. */
  status: z.enum(["COMPLETE", "PARTIAL", "BLOCKED", "NEEDS_REPLAN"]),
  /** Resource usage metrics. */
  metrics: TaskResultMetricsSchema.optional(),
  /** Files modified during execution. */
  files_modified: z.array(z.string()).default([]),
  /** Free-text observations from the executor. */
  observations: z.array(z.string()).default([]),
  /** Error message when status is BLOCKED or NEEDS_REPLAN. */
  error: z.string().optional(),
});

export type TaskResultMetrics = z.infer<typeof TaskResultMetricsSchema>;
export type TaskResult = z.infer<typeof TaskResultSchema>;
