import { z } from "zod";

// ── Component Manifest ──

export const StabilitySchema = z.enum(["stable", "active", "experimental"]);

export const ComponentSchema = z.object({
  path: z.string(),
  deps: z.array(z.string()).optional(),
  docs: z.array(z.string()).default([]),
  tags: z.array(z.string()).optional(),
  test: z.string().optional(),
  env: z.array(z.string()).optional(),
  stability: StabilitySchema.optional(),
});

export const ManifestSchema = z.object({
  varp: z.string(),
  components: z.record(z.string(), ComponentSchema),
});

export type DocEntry = string;
export type Stability = z.infer<typeof StabilitySchema>;
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

// ── Import Scanner ──

export const ImportEvidenceSchema = z.object({
  source_file: z.string(),
  import_specifier: z.string(),
});

export const ImportDepSchema = z.object({
  from: z.string(),
  to: z.string(),
  evidence: z.array(ImportEvidenceSchema),
});

export const ImportScanResultSchema = z.object({
  import_deps: z.array(ImportDepSchema),
  missing_deps: z.array(ImportDepSchema),
  extra_deps: z.array(z.object({ from: z.string(), to: z.string() })),
  total_files_scanned: z.number(),
  total_imports_scanned: z.number(),
});

export type ImportEvidence = z.infer<typeof ImportEvidenceSchema>;
export type ImportDep = z.infer<typeof ImportDepSchema>;
export type ImportScanResult = z.infer<typeof ImportScanResultSchema>;

// ── Validation ──

export const ValidationResultSchema = z.object({
  valid: z.boolean(),
  errors: z.array(z.string()),
  warnings: z.array(z.string()),
});

export type ValidationResult = z.infer<typeof ValidationResultSchema>;

// ── Plan Diff ──

export const MetadataChangeSchema = z.object({
  field: z.string(),
  old_value: z.string(),
  new_value: z.string(),
});

export const ContractChangeSchema = z.object({
  id: z.string(),
  section: z.enum(["preconditions", "invariants", "postconditions"]),
  type: z.enum(["added", "removed", "modified"]),
  old_value: z
    .object({
      description: z.string(),
      verify: z.string(),
      critical: z.boolean().optional(),
    })
    .optional(),
  new_value: z
    .object({
      description: z.string(),
      verify: z.string(),
      critical: z.boolean().optional(),
    })
    .optional(),
});

export const TaskFieldChangeSchema = z.object({
  field: z.string(),
  old_value: z.unknown(),
  new_value: z.unknown(),
});

export const TaskChangeSchema = z.object({
  id: z.string(),
  type: z.enum(["added", "removed", "modified"]),
  changes: z.array(TaskFieldChangeSchema).optional(),
});

export const PlanDiffSchema = z.object({
  metadata: z.array(MetadataChangeSchema),
  contracts: z.array(ContractChangeSchema),
  tasks: z.array(TaskChangeSchema),
});

export type MetadataChange = z.infer<typeof MetadataChangeSchema>;
export type ContractChange = z.infer<typeof ContractChangeSchema>;
export type TaskFieldChange = z.infer<typeof TaskFieldChangeSchema>;
export type TaskChange = z.infer<typeof TaskChangeSchema>;
export type PlanDiff = z.infer<typeof PlanDiffSchema>;

// ── Lint Report ──

export const LintIssueSeveritySchema = z.enum(["error", "warning"]);
export const LintIssueCategorySchema = z.enum(["imports", "links", "freshness"]);

export const LintIssueSchema = z.object({
  severity: LintIssueSeveritySchema,
  category: LintIssueCategorySchema,
  message: z.string(),
  component: z.string().optional(),
});

export const LintReportSchema = z.object({
  total_issues: z.number(),
  issues: z.array(LintIssueSchema),
});

export type LintIssueSeverity = z.infer<typeof LintIssueSeveritySchema>;
export type LintIssueCategory = z.infer<typeof LintIssueCategorySchema>;
export type LintIssue = z.infer<typeof LintIssueSchema>;
export type LintReport = z.infer<typeof LintReportSchema>;

// ── Scoped Tests ──

export const ScopedTestResultSchema = z.object({
  test_files: z.array(z.string()),
  components_covered: z.array(z.string()),
  run_command: z.string(),
  custom_commands: z.array(z.string()),
});

export type ScopedTestResult = z.infer<typeof ScopedTestResultSchema>;

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
