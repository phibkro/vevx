import type { Task, Wave } from "../types.js";
import { detectHazards } from "./hazards.js";
import { computeCriticalPath } from "./critical-path.js";

export function computeWaves(tasks: Task[]): Wave[] {
  if (tasks.length === 0) return [];

  const hazards = detectHazards(tasks);

  // Build dependency graph from RAW hazards
  // RAW(source, target) means target depends on source
  const deps = new Map<string, Set<string>>();
  for (const t of tasks) deps.set(t.id, new Set());

  for (const h of hazards) {
    if (h.type === "RAW") {
      deps.get(h.target_task_id)?.add(h.source_task_id);
    }
  }

  // Also add WAW as ordering constraints (first task goes first)
  for (const h of hazards) {
    if (h.type === "WAW") {
      deps.get(h.target_task_id)?.add(h.source_task_id);
    }
  }

  // Topological sort with wave grouping (longest path from roots)
  const waveNumber = new Map<string, number>();

  function getWave(taskId: string, visited: Set<string>): number {
    if (waveNumber.has(taskId)) return waveNumber.get(taskId)!;
    if (visited.has(taskId))
      throw new Error(`Cycle detected involving task ${taskId}`);
    visited.add(taskId);

    let maxDepWave = -1;
    for (const depId of deps.get(taskId) ?? []) {
      maxDepWave = Math.max(maxDepWave, getWave(depId, visited));
    }

    const wave = maxDepWave + 1;
    waveNumber.set(taskId, wave);
    visited.delete(taskId);
    return wave;
  }

  for (const t of tasks) {
    getWave(t.id, new Set());
  }

  // Group by wave
  const waveGroups = new Map<number, Task[]>();
  for (const t of tasks) {
    const w = waveNumber.get(t.id)!;
    if (!waveGroups.has(w)) waveGroups.set(w, []);
    waveGroups.get(w)!.push(t);
  }

  // Get critical path for ordering within waves
  const criticalPath = computeCriticalPath(tasks);
  const criticalSet = new Set(criticalPath.task_ids);

  // Build waves, ordering critical path tasks first within each wave
  const waves: Wave[] = [];
  const sortedWaveIds = [...waveGroups.keys()].sort((a, b) => a - b);

  for (const waveId of sortedWaveIds) {
    const waveTasks = waveGroups.get(waveId)!;
    waveTasks.sort((a, b) => {
      const aOnCritical = criticalSet.has(a.id) ? 0 : 1;
      const bOnCritical = criticalSet.has(b.id) ? 0 : 1;
      return aOnCritical - bOnCritical;
    });
    waves.push({ id: waveId, tasks: waveTasks });
  }

  return waves;
}
