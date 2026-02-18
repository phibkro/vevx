import type { Task, Plan } from "./types.js";

/**
 * Create a Task with sensible defaults. Use in tests to avoid repeating boilerplate.
 */
export function makeTask(
  id: string,
  writes?: string[],
  reads?: string[],
  mutexes?: string[],
): Task {
  return {
    id,
    description: `Task ${id}`,
    action: "implement",
    values: ["correctness"],
    touches: { writes, reads },
    ...(mutexes ? { mutexes } : {}),
  };
}

/**
 * Create a Plan with sensible defaults. Use in tests to avoid repeating boilerplate.
 */
export function makePlan(tasks: Plan["tasks"], contract?: Partial<Plan["contract"]>): Plan {
  return {
    metadata: { feature: "test", created: "2026-01-01" },
    contract: {
      preconditions: contract?.preconditions ?? [],
      invariants: contract?.invariants ?? [],
      postconditions: contract?.postconditions ?? [
        { id: "post-1", description: "test", verify: "echo ok" },
      ],
    },
    tasks,
  };
}
