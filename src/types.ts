import { z } from "zod";

// ── Component Manifest ──

export const ComponentSchema = z.object({
  path: z.string(),
  deps: z.array(z.string()).optional(),
  docs: z.array(z.string()).default([]),
});

export const ManifestSchema = z.object({
  varp: z.string(),
  components: z.record(z.string(), ComponentSchema),
});

export type DocEntry = string;
export type Component = z.infer<typeof ComponentSchema>;
export type Manifest = z.infer<typeof ManifestSchema>;

// ── Touches ──

export const TouchesSchema = z.object({
  reads: z.array(z.string()).optional(),
  writes: z.array(z.string()).optional(),
});

export type Touches = z.infer<typeof TouchesSchema>;

// ── Budget ──

export const BudgetSchema = z.object({
  tokens: z.number().positive(),
  minutes: z.number().positive(),
});

export type Budget = z.infer<typeof BudgetSchema>;

// ── Resolved Docs ──

export const ResolvedDocSchema = z.object({
  component: z.string(),
  doc: z.string(),
  path: z.string(),
});

export const ResolvedDocsSchema = z.object({
  docs: z.array(ResolvedDocSchema),
});

export type ResolvedDoc = z.infer<typeof ResolvedDocSchema>;
export type ResolvedDocs = z.infer<typeof ResolvedDocsSchema>;

// ── Freshness ──

export const DocFreshnessSchema = z.object({
  path: z.string(),
  last_modified: z.string(),
  stale: z.boolean(),
});

export const ComponentFreshnessSchema = z.object({
  docs: z.record(z.string(), DocFreshnessSchema),
  source_last_modified: z.string(),
});

export const FreshnessReportSchema = z.object({
  components: z.record(z.string(), ComponentFreshnessSchema),
});

export type DocFreshness = z.infer<typeof DocFreshnessSchema>;
export type ComponentFreshness = z.infer<typeof ComponentFreshnessSchema>;
export type FreshnessReport = z.infer<typeof FreshnessReportSchema>;

// ── Plan ──

export const ConditionSchema = z.object({
  id: z.string(),
  description: z.string(),
  verify: z.string(),
});

export const InvariantSchema = ConditionSchema.extend({
  critical: z.boolean(),
});

export const ContractSchema = z.object({
  preconditions: z.array(ConditionSchema),
  invariants: z.array(InvariantSchema),
  postconditions: z.array(ConditionSchema),
});

export const TaskSchema = z.object({
  id: z.string(),
  description: z.string(),
  action: z.string(),
  values: z.array(z.string()),
  touches: TouchesSchema,
  budget: BudgetSchema,
});

export const PlanMetadataSchema = z.object({
  feature: z.string(),
  created: z.string(),
});

export const PlanSchema = z.object({
  metadata: PlanMetadataSchema,
  contract: ContractSchema,
  tasks: z.array(TaskSchema),
});

export type Condition = z.infer<typeof ConditionSchema>;
export type Invariant = z.infer<typeof InvariantSchema>;
export type Contract = z.infer<typeof ContractSchema>;
export type Task = z.infer<typeof TaskSchema>;
export type PlanMetadata = z.infer<typeof PlanMetadataSchema>;
export type Plan = z.infer<typeof PlanSchema>;

// ── Scheduler ──

export const WaveSchema = z.object({
  id: z.number(),
  tasks: z.array(TaskSchema),
});

export const HazardSchema = z.object({
  type: z.enum(["RAW", "WAR", "WAW"]),
  source_task_id: z.string(),
  target_task_id: z.string(),
  component: z.string(),
});

export const CriticalPathSchema = z.object({
  task_ids: z.array(z.string()),
  total_budget: BudgetSchema,
});

export type Wave = z.infer<typeof WaveSchema>;
export type Hazard = z.infer<typeof HazardSchema>;
export type CriticalPath = z.infer<typeof CriticalPathSchema>;

// ── Enforcement ──

export const ViolationSchema = z.object({
  path: z.string(),
  declared_component: z.string().nullable(),
  actual_component: z.string(),
});

export const CapabilityReportSchema = z.object({
  valid: z.boolean(),
  violations: z.array(ViolationSchema),
});

export const RestartStrategySchema = z.object({
  strategy: z.enum(["isolated_retry", "cascade_restart", "escalate"]),
  reason: z.string(),
  affected_tasks: z.array(z.string()),
});

export type Violation = z.infer<typeof ViolationSchema>;
export type CapabilityReport = z.infer<typeof CapabilityReportSchema>;
export type RestartStrategy = z.infer<typeof RestartStrategySchema>;

// ── Link Scanner ──

export const BrokenLinkSchema = z.object({
  source_doc: z.string(),
  source_component: z.string(),
  link_text: z.string(),
  link_target: z.string(),
  resolved_path: z.string(),
  reason: z.string(),
});

export const InferredDepSchema = z.object({
  from: z.string(),
  to: z.string(),
  evidence: z.array(
    z.object({
      source_doc: z.string(),
      link_target: z.string(),
    }),
  ),
});

export const LinkScanResultSchema = z.object({
  inferred_deps: z.array(InferredDepSchema),
  missing_deps: z.array(InferredDepSchema),
  extra_deps: z.array(z.object({ from: z.string(), to: z.string() })),
  broken_links: z.array(BrokenLinkSchema),
  missing_docs: z.array(z.string()),
  total_links_scanned: z.number(),
  total_docs_scanned: z.number(),
});

export type BrokenLink = z.infer<typeof BrokenLinkSchema>;
export type InferredDep = z.infer<typeof InferredDepSchema>;
export type LinkScanResult = z.infer<typeof LinkScanResultSchema>;

// ── Validation ──

export const ValidationResultSchema = z.object({
  valid: z.boolean(),
  errors: z.array(z.string()),
  warnings: z.array(z.string()),
});

export type ValidationResult = z.infer<typeof ValidationResultSchema>;

// ── Execution Metrics ──

export const ExecutionMetricsSchema = z.object({
  task_id: z.string(),
  tokens_used: z.number(),
  minutes_elapsed: z.number(),
  tools_invoked: z.number(),
  files_modified: z.array(z.string()),
  exit_status: z.enum(["COMPLETE", "PARTIAL", "BLOCKED", "NEEDS_REPLAN"]),
  restart_count: z.number(),
  capability_violations: z.number(),
});

export type ExecutionMetrics = z.infer<typeof ExecutionMetricsSchema>;
