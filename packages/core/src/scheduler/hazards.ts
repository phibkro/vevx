import type { Task, Hazard } from "#shared/types.js";

type TaskRef = Pick<Task, "id" | "touches"> & { mutexes?: string[] };

/**
 * Pairwise hazard detection — O(n^2) over tasks, O(k) per pair over shared components.
 * For each unique pair (i, j), checks all components in their combined touch sets
 * for RAW (true dependency), WAW (output conflict), and WAR (anti-dependency).
 * WAR is suppressed when the reader also writes (already captured by WAW + RAW).
 */
export function detectHazards(tasks: TaskRef[]): Hazard[] {
  const hazards: Hazard[] = [];

  for (let i = 0; i < tasks.length; i++) {
    for (let j = i + 1; j < tasks.length; j++) {
      const a = tasks[i];
      const b = tasks[j];

      const aWrites = new Set(a.touches.writes ?? []);
      const aReads = new Set(a.touches.reads ?? []);
      const bWrites = new Set(b.touches.writes ?? []);
      const bReads = new Set(b.touches.reads ?? []);

      const allComponents = new Set([...aWrites, ...aReads, ...bWrites, ...bReads]);

      for (const comp of allComponents) {
        // RAW: source writes, target reads — true dependency
        if (aWrites.has(comp) && bReads.has(comp)) {
          hazards.push({
            type: "RAW",
            source_task_id: a.id,
            target_task_id: b.id,
            component: comp,
          });
        }
        if (bWrites.has(comp) && aReads.has(comp)) {
          hazards.push({
            type: "RAW",
            source_task_id: b.id,
            target_task_id: a.id,
            component: comp,
          });
        }

        // WAW: both write — output dependency
        if (aWrites.has(comp) && bWrites.has(comp)) {
          hazards.push({
            type: "WAW",
            source_task_id: a.id,
            target_task_id: b.id,
            component: comp,
          });
        }

        // WAR: source reads, target writes — anti-dependency
        // Only when source does NOT also write the same component
        // (if it did, the WAW + RAW already capture the relationship)
        if (aReads.has(comp) && bWrites.has(comp) && !aWrites.has(comp)) {
          hazards.push({
            type: "WAR",
            source_task_id: a.id,
            target_task_id: b.id,
            component: comp,
          });
        }
        if (bReads.has(comp) && aWrites.has(comp) && !bWrites.has(comp)) {
          hazards.push({
            type: "WAR",
            source_task_id: b.id,
            target_task_id: a.id,
            component: comp,
          });
        }
      }

      // MUTEX: shared mutex names — mutual exclusion constraint
      const aMutexes = new Set(a.mutexes ?? []);
      const bMutexes = new Set(b.mutexes ?? []);
      for (const mutex of aMutexes) {
        if (bMutexes.has(mutex)) {
          hazards.push({
            type: "MUTEX",
            source_task_id: a.id,
            target_task_id: b.id,
            component: mutex,
          });
        }
      }
    }
  }

  return hazards;
}
