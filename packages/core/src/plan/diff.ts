import type {
  Plan,
  PlanDiff,
  MetadataChange,
  ContractChange,
  TaskChange,
  TaskFieldChange,
} from "#shared/types.js";

/**
 * Structurally diff two parsed plans.
 * Pure function — no I/O.
 */
export function diffPlans(planA: Plan, planB: Plan): PlanDiff {
  return {
    metadata: diffMetadata(planA, planB),
    contracts: diffContracts(planA, planB),
    tasks: diffTasks(planA, planB),
  };
}

// ── Metadata ──

function diffMetadata(planA: Plan, planB: Plan): MetadataChange[] {
  const changes: MetadataChange[] = [];
  if (planA.metadata.feature !== planB.metadata.feature) {
    changes.push({
      field: "feature",
      old_value: planA.metadata.feature,
      new_value: planB.metadata.feature,
    });
  }
  if (planA.metadata.created !== planB.metadata.created) {
    changes.push({
      field: "created",
      old_value: planA.metadata.created,
      new_value: planB.metadata.created,
    });
  }
  return changes;
}

// ── Contracts ──

type ConditionLike = { id: string; description: string; verify: string; critical?: boolean };

function conditionToValue(c: ConditionLike): {
  description: string;
  verify: string;
  critical?: boolean;
} {
  const val: { description: string; verify: string; critical?: boolean } = {
    description: c.description,
    verify: c.verify,
  };
  if (c.critical !== undefined) {
    val.critical = c.critical;
  }
  return val;
}

function conditionsEqual(a: ConditionLike, b: ConditionLike): boolean {
  return a.description === b.description && a.verify === b.verify && a.critical === b.critical;
}

function diffConditionSection(
  sectionA: ConditionLike[],
  sectionB: ConditionLike[],
  section: "preconditions" | "invariants" | "postconditions",
): ContractChange[] {
  const changes: ContractChange[] = [];
  const mapA = new Map(sectionA.map((c) => [c.id, c]));
  const mapB = new Map(sectionB.map((c) => [c.id, c]));

  // Removed: in A but not in B
  for (const [id, cond] of mapA) {
    if (!mapB.has(id)) {
      changes.push({ id, section, type: "removed", old_value: conditionToValue(cond) });
    }
  }

  // Added: in B but not in A
  for (const [id, cond] of mapB) {
    if (!mapA.has(id)) {
      changes.push({ id, section, type: "added", new_value: conditionToValue(cond) });
    }
  }

  // Modified: in both but different
  for (const [id, condA] of mapA) {
    const condB = mapB.get(id);
    if (condB && !conditionsEqual(condA, condB)) {
      changes.push({
        id,
        section,
        type: "modified",
        old_value: conditionToValue(condA),
        new_value: conditionToValue(condB),
      });
    }
  }

  return changes;
}

function diffContracts(planA: Plan, planB: Plan): ContractChange[] {
  return [
    ...diffConditionSection(
      planA.contract.preconditions,
      planB.contract.preconditions,
      "preconditions",
    ),
    ...diffConditionSection(
      planA.contract.invariants as ConditionLike[],
      planB.contract.invariants as ConditionLike[],
      "invariants",
    ),
    ...diffConditionSection(
      planA.contract.postconditions,
      planB.contract.postconditions,
      "postconditions",
    ),
  ];
}

// ── Tasks ──

function diffTasks(planA: Plan, planB: Plan): TaskChange[] {
  const changes: TaskChange[] = [];
  const mapA = new Map(planA.tasks.map((t) => [t.id, t]));
  const mapB = new Map(planB.tasks.map((t) => [t.id, t]));

  // Removed tasks
  for (const [id] of mapA) {
    if (!mapB.has(id)) {
      changes.push({ id, type: "removed" });
    }
  }

  // Added tasks
  for (const [id] of mapB) {
    if (!mapA.has(id)) {
      changes.push({ id, type: "added" });
    }
  }

  // Modified tasks
  for (const [id, taskA] of mapA) {
    const taskB = mapB.get(id);
    if (!taskB) continue;

    const fieldChanges: TaskFieldChange[] = [];

    if (taskA.description !== taskB.description) {
      fieldChanges.push({
        field: "description",
        old_value: taskA.description,
        new_value: taskB.description,
      });
    }
    if (taskA.action !== taskB.action) {
      fieldChanges.push({ field: "action", old_value: taskA.action, new_value: taskB.action });
    }
    if (!arraysEqual(taskA.values, taskB.values)) {
      fieldChanges.push({ field: "values", old_value: taskA.values, new_value: taskB.values });
    }
    if (!touchesEqual(taskA.touches, taskB.touches)) {
      fieldChanges.push({ field: "touches", old_value: taskA.touches, new_value: taskB.touches });
    }

    if (fieldChanges.length > 0) {
      changes.push({ id, type: "modified", changes: fieldChanges });
    }
  }

  return changes;
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function touchesEqual(
  a: { reads?: string[]; writes?: string[] },
  b: { reads?: string[]; writes?: string[] },
): boolean {
  return arraysEqual(a.reads ?? [], b.reads ?? []) && arraysEqual(a.writes ?? [], b.writes ?? []);
}
