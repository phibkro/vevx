import type { Task, RestartStrategy } from "../types.js";

type TaskRef = Pick<Task, "id" | "touches">;

/**
 * Given a failed task and execution state, derive the restart strategy:
 * - isolated_retry: failed task's writes are disjoint from downstream reads
 * - cascade_restart: downstream tasks consumed the failed task's output
 * - escalate: planning problem, not execution problem
 */
export function deriveRestartStrategy(
  failedTask: TaskRef,
  allTasks: TaskRef[],
  completedTaskIds: string[],
  dispatchedTaskIds: string[],
): RestartStrategy {
  const failedWrites = new Set(failedTask.touches.writes ?? []);

  if (failedWrites.size === 0) {
    // Task with no writes can always be safely retried
    return {
      strategy: "isolated_retry",
      reason: "Task has no write set — retry is safe",
      affected_tasks: [],
    };
  }

  // Find downstream tasks that read from the failed task's write set
  const activeTaskIds = new Set([...completedTaskIds, ...dispatchedTaskIds]);
  const affectedTasks: string[] = [];

  for (const task of allTasks) {
    if (task.id === failedTask.id) continue;
    if (!activeTaskIds.has(task.id)) continue;

    const taskReads = new Set(task.touches.reads ?? []);
    for (const comp of failedWrites) {
      if (taskReads.has(comp)) {
        affectedTasks.push(task.id);
        break;
      }
    }
  }

  if (affectedTasks.length === 0) {
    return {
      strategy: "isolated_retry",
      reason: `Failed task's write set [${[...failedWrites].join(", ")}] is disjoint from all active downstream read sets`,
      affected_tasks: [],
    };
  }

  // Check if affected tasks are only dispatched (not completed)
  const completedAffected = affectedTasks.filter((id) => completedTaskIds.includes(id));

  if (completedAffected.length > 0) {
    // Completed downstream tasks consumed potentially incorrect output
    // This may indicate a planning problem
    return {
      strategy: "escalate",
      reason: `Completed tasks [${completedAffected.join(", ")}] consumed output from failed task — potential planning problem`,
      affected_tasks: affectedTasks,
    };
  }

  // All affected tasks are dispatched but not completed — cascade restart
  return {
    strategy: "cascade_restart",
    reason: `Dispatched tasks [${affectedTasks.join(", ")}] consume output from failed task — cascade required`,
    affected_tasks: affectedTasks,
  };
}
