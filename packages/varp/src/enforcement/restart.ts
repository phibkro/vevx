import type { Task, RestartStrategy } from "#shared/types.js";

type TaskRef = Pick<Task, "id" | "touches"> & { mutexes?: string[] };

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
  const failedMutexes = new Set(failedTask.mutexes ?? []);

  if (failedWrites.size === 0 && failedMutexes.size === 0) {
    // Task with no writes and no mutexes can always be safely retried
    return {
      strategy: "isolated_retry",
      reason: "Task has no write set and no mutexes — retry is safe",
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
    let affected = false;
    for (const comp of failedWrites) {
      if (taskReads.has(comp)) {
        affected = true;
        break;
      }
    }

    // Check mutex overlap — shared mutexes mean resource contention
    if (!affected && failedMutexes.size > 0) {
      const taskMutexes = new Set(task.mutexes ?? []);
      for (const mutex of failedMutexes) {
        if (taskMutexes.has(mutex)) {
          affected = true;
          break;
        }
      }
    }

    if (affected) {
      affectedTasks.push(task.id);
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
