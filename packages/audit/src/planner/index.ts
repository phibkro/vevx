export { parseRuleset } from './ruleset-parser';
export { generatePlan, groupIntoComponents } from './planner';
export {
  findManifest,
  parseManifest,
  loadManifestComponents,
  matchRulesByTags,
  assignFilesToComponents,
} from './manifest-adapter';
export type { Manifest, ManifestComponent } from './manifest-adapter';
export {
  compareSeverity,
  findingsOverlap,
  deduplicateFindings,
  summarizeFindings,
} from './findings';
export type {
  RulesetMeta,
  Rule,
  CrossCuttingPattern,
  Ruleset,
  AuditComponent,
  AuditTask,
  AuditPlan,
  ModelCaller,
  ModelCallerResult,
} from './types';
export type {
  AuditSeverity,
  CodeLocation,
  AuditFinding,
  AuditTaskResult,
  CoverageEntry,
  CorroboratedFinding,
  ComplianceReport,
} from './findings';
export {
  generatePrompt,
  generateComponentScanPrompt,
  generateCrossCuttingPrompt,
  parseAuditResponse,
  AUDIT_FINDINGS_SCHEMA,
} from './prompt-generator';
export type { AuditPrompt } from './prompt-generator';
export { executeAuditPlan } from './executor';
export type {
  AuditProgressEvent,
  ProgressCallback,
  ExecutorOptions,
} from './executor';
export {
  printComplianceReport,
  generateComplianceMarkdown,
  generateComplianceJson,
} from './compliance-reporter';
export {
  parseSuppressConfig,
  parseInlineSuppressions,
  applySuppressions,
  findingSuppressedBy,
} from './suppressions';
export type { SuppressionRule, InlineSuppression, SuppressionConfig } from './suppressions';
export {
  getChangedFiles,
  filterToChanged,
  expandWithDependents,
} from './diff-filter';
