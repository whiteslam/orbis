import { test } from 'vitest';
import assert from 'node:assert/strict';
import { runPool, withTimeout } from './pool.ts';

test('no more than `limit` tasks run at once, and every item runs with time to spare', async () => {
  let running = 0;
  let peak = 0;
  const task = async (item: number) => {
    running += 1;
    peak = Math.max(peak, running);
    await new Promise((resolve) => setTimeout(resolve, 5));
    running -= 1;
    return item * 2;
  };
  const result = await runPool([1, 2, 3, 4, 5, 6, 7], task, { limit: 3, deadline: Date.now() + 60_000, taskMs: 1_000 });
  assert.equal(peak, 3);
  assert.equal(result.started, 7);
  assert.equal(result.skipped, 0);
  assert.deepEqual(result.results.toSorted((a, b) => a - b), [2, 4, 6, 8, 10, 12, 14]);
});

test('nothing new starts once there is not time for it to finish', async () => {
  let clock = 0;
  const task = async (item: number) => {
    clock += 10;
    return item;
  };
  // Each task moves the clock 10; a task needs 15 left; the budget ends at 40.
  const result = await runPool([1, 2, 3, 4, 5], task, { limit: 1, deadline: 40, taskMs: 15, now: () => clock });
  assert.deepEqual(result.results, [1, 2, 3]);
  assert.equal(result.skipped, 2);
});

test('a task that throws does not stop the others', async () => {
  const task = async (item: number) => {
    if (item === 2) throw new Error('boom');
    return item;
  };
  const result = await runPool([1, 2, 3], task, { limit: 2, deadline: Date.now() + 60_000, taskMs: 0 });
  assert.deepEqual(result.results.toSorted((a, b) => a - b), [1, 3]);
  assert.equal(result.started, 3);
});

test('withTimeout gives the fallback when the work is slow', async () => {
  const slow = new Promise<string>((resolve) => setTimeout(() => resolve('late'), 200));
  assert.equal(await withTimeout(slow, 10, 'fallback'), 'fallback');
  assert.equal(await withTimeout(Promise.resolve('fast'), 1_000, 'fallback'), 'fast');
});
