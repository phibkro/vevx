/**
 * Callbacks for monitoring task execution.
 */
export interface ConcurrencyCallbacks<TTask, TResult> {
  onResult?: (task: TTask, result: TResult) => void;
  onError?: (task: TTask, error: Error) => void;
}

/**
 * Run tasks with bounded concurrency using a worker pool pattern.
 *
 * Spawns up to `concurrency` workers that pull from a shared task queue.
 * Results are returned in completion order (not task order).
 * Errors are passed to `onError` and do not stop other workers.
 */
export async function runWithConcurrency<TTask, TResult>(
  tasks: TTask[],
  run: (task: TTask) => Promise<TResult>,
  concurrency: number,
  callbacks?: ConcurrencyCallbacks<TTask, TResult>,
): Promise<TResult[]> {
  if (tasks.length === 0) return [];

  const results: TResult[] = [];
  let index = 0;

  async function worker() {
    while (index < tasks.length) {
      const taskIndex = index++;
      const task = tasks[taskIndex];
      try {
        const result = await run(task);
        results.push(result);
        callbacks?.onResult?.(task, result);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        callbacks?.onError?.(task, error);
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker());
  await Promise.all(workers);

  return results;
}
