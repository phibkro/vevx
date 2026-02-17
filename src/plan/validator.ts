import type { Plan, Manifest, Hazard, ValidationResult } from "../types.js";

/**
 * Validate plan consistency against manifest.
 * Accepts optional pre-computed hazards for WAW warnings.
 * When hazards are not provided, WAW checking is skipped.
 */
export function validatePlan(plan: Plan, manifest: Manifest, hazards?: Hazard[]): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const componentNames = new Set(Object.keys(manifest.components));

  // Check task ID uniqueness
  const taskIds = new Set<string>();
  for (const task of plan.tasks) {
    if (taskIds.has(task.id)) {
      errors.push(`Duplicate task ID: ${task.id}`);
    }
    taskIds.add(task.id);
  }

  // Check all touches reference known components
  for (const task of plan.tasks) {
    for (const comp of task.touches.reads ?? []) {
      if (!componentNames.has(comp)) {
        errors.push(`Task ${task.id}: unknown read component "${comp}"`);
      }
    }
    for (const comp of task.touches.writes ?? []) {
      if (!componentNames.has(comp)) {
        errors.push(`Task ${task.id}: unknown write component "${comp}"`);
      }
    }
  }

  // Check budget values are positive
  for (const task of plan.tasks) {
    if (task.budget.tokens <= 0) {
      errors.push(`Task ${task.id}: budget tokens must be positive`);
    }
    if (task.budget.minutes <= 0) {
      errors.push(`Task ${task.id}: budget minutes must be positive`);
    }
  }

  // Check verify commands are non-empty
  for (const cond of [...plan.contract.preconditions, ...plan.contract.postconditions]) {
    if (!cond.verify.trim()) {
      errors.push(`Condition ${cond.id}: verify command is empty`);
    }
  }
  for (const inv of plan.contract.invariants) {
    if (!inv.verify.trim()) {
      errors.push(`Invariant ${inv.id}: verify command is empty`);
    }
  }

  // Report WAW hazards as warnings (if hazards provided)
  if (hazards) {
    for (const h of hazards) {
      if (h.type === "WAW") {
        warnings.push(
          `WAW hazard: tasks ${h.source_task_id} and ${h.target_task_id} both write to "${h.component}"`,
        );
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
