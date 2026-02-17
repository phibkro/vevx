import type { Task, Hazard, CriticalPath, Budget } from "../types.js";
import { detectHazards } from "./hazards.js";

/**
 * Compute the longest chain of RAW dependencies via memoized DP.
 * Pass pre-computed hazards to avoid redundant detection (e.g. when called from computeWaves).
 */
export function computeCriticalPath(tasks: Task[], hazards?: Hazard[]): CriticalPath {
  if (tasks.length === 0) {
    return { task_ids: [], total_budget: { tokens: 0, minutes: 0 } };
  }

  const detectedHazards = hazards ?? detectHazards(tasks);
  const taskMap = new Map(tasks.map((t) => [t.id, t]));

  // Build DAG from RAW hazards: predecessors for each task
  const predecessors = new Map<string, string[]>();
  for (const t of tasks) {
    predecessors.set(t.id, []);
  }

  for (const h of detectedHazards) {
    if (h.type === "RAW") {
      // source must finish before target
      if (!predecessors.get(h.target_task_id)!.includes(h.source_task_id)) {
        predecessors.get(h.target_task_id)!.push(h.source_task_id);
      }
    }
  }

  // Find longest path using dynamic programming
  const memo = new Map<string, { length: number; path: string[] }>();

  function longestPathTo(taskId: string): { length: number; path: string[] } {
    if (memo.has(taskId)) return memo.get(taskId)!;

    let best = { length: 1, path: [taskId] };

    for (const pred of predecessors.get(taskId) ?? []) {
      const predPath = longestPathTo(pred);
      if (predPath.length + 1 > best.length) {
        best = {
          length: predPath.length + 1,
          path: [...predPath.path, taskId],
        };
      }
    }

    memo.set(taskId, best);
    return best;
  }

  let criticalPath = { length: 0, path: [] as string[] };
  for (const t of tasks) {
    const result = longestPathTo(t.id);
    if (result.length > criticalPath.length) {
      criticalPath = result;
    }
  }

  const totalBudget: Budget = { tokens: 0, minutes: 0 };
  for (const id of criticalPath.path) {
    const task = taskMap.get(id)!;
    totalBudget.tokens += task.budget.tokens;
    totalBudget.minutes += task.budget.minutes;
  }

  return { task_ids: criticalPath.path, total_budget: totalBudget };
}
