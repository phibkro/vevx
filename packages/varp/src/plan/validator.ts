import type { Plan, Manifest, Hazard, ValidationResult, ImportDep } from "#shared/types.js";

/**
 * Validate plan consistency against manifest.
 * Accepts optional pre-computed hazards for WAW warnings.
 * When hazards are not provided, WAW checking is skipped.
 * Accepts optional import deps for undeclared-read warnings.
 */
export function validatePlan(
  plan: Plan,
  manifest: Manifest,
  hazards?: Hazard[],
  importDeps?: ImportDep[],
): ValidationResult {
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

  // Report undeclared import dependencies as warnings (if importDeps provided)
  if (importDeps) {
    for (const task of plan.tasks) {
      const writeComps = task.touches.writes ?? [];
      const readComps = task.touches.reads ?? [];
      const declaredComps = new Set([...writeComps, ...readComps]);

      for (const writeComp of writeComps) {
        for (const dep of importDeps) {
          if (dep.from === writeComp && !declaredComps.has(dep.to)) {
            warnings.push(
              `Task ${task.id} writes to "${writeComp}" which imports from "${dep.to}" — consider adding reads: ["${dep.to}"]`,
            );
          }
        }
      }
    }
  }

  // Report dead mutexes (mutex name only used by one task)
  const mutexUsage = new Map<string, string[]>();
  for (const task of plan.tasks) {
    for (const mutex of task.mutexes ?? []) {
      if (!mutexUsage.has(mutex)) mutexUsage.set(mutex, []);
      mutexUsage.get(mutex)!.push(task.id);
    }
  }
  for (const [mutex, taskIds] of mutexUsage) {
    if (taskIds.length === 1) {
      warnings.push(`Dead mutex "${mutex}" — only used by task ${taskIds[0]}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
