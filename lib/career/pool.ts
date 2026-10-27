/**
 * Running a batch of slow tasks a few at a time within a time budget. Pure
 * (time is injected), so the scheduling is unit-tested.
 *
 * The crons call models that may take 20 seconds each. One at a time would
 * spend the whole 50-second budget on two jobs; all at once would fan dozens of
 * requests at the providers and blow the budget anyway. A small pool keeps a
 * few in flight and stops starting new ones once there isn't time for one to
 * finish; whatever is left is picked up by the next run.
 */

export type PoolOptions = {
  /** Tasks in flight at once. */
  limit: number;
  /** Epoch ms after which nothing new starts. */
  deadline: number;
  /** How long one task may need; a task is started only with this much left. */
  taskMs: number;
  now?: () => number;
};

export type PoolResult<R> = { results: R[]; started: number; skipped: number };

/**
 * `task` over `items`, at most `limit` at a time, in order of `items`. A task
 * that throws counts as started and contributes no result. Results come back
 * in completion order.
 */
export async function runPool<T, R>(items: readonly T[], task: (item: T) => Promise<R>, options: PoolOptions): Promise<PoolResult<R>> {
  const now = options.now ?? Date.now;
  const results: R[] = [];
  let next = 0;
  let started = 0;
  const lane = async () => {
    while (next < items.length && options.deadline - now() >= options.taskMs) {
      const item = items[next];
      next += 1;
      started += 1;
      try {
        results.push(await task(item)); // NOSONAR: each lane runs its tasks one after another; the lanes run side by side
      } catch (error) {
        console.error('A pooled career task failed', error);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(options.limit, items.length)) }, lane));
  return { results, started, skipped: items.length - started };
}

/** `promise`, or `fallback` once `ms` has passed. The work itself isn't cancelled, only no longer waited for. */
export async function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), Math.max(0, ms));
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
