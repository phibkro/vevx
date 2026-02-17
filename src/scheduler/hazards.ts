import type { Task, Hazard } from "../types.js";

export function detectHazards(tasks: Task[]): Hazard[] {
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
    }
  }

  return hazards;
}
