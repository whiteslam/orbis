import { test } from 'vitest';
import assert from 'node:assert/strict';
import { shared } from './inflight.ts';

test('a second caller while the first is pending gets the same answer, not a second request', async () => {
  let calls = 0;
  let release: (value: string) => void = () => {};
  const load = () => { calls += 1; return new Promise<string>((resolve) => { release = resolve; }); };
  const first = shared('news', load);
  const second = shared('news', load);
  release('digest');
  assert.deepEqual(await Promise.all([first, second]), ['digest', 'digest']);
  assert.equal(calls, 1);
});

test('once settled, the next caller asks again', async () => {
  let calls = 0;
  const load = async () => { calls += 1; return calls; };
  assert.equal(await shared('weather', load), 1);
  assert.equal(await shared('weather', load), 2);
});

test('a failure is shared too, and the next caller can try again', async () => {
  let calls = 0;
  const load = async () => { calls += 1; throw new Error('down'); };
  await assert.rejects(Promise.all([shared('mail', load), shared('mail', load)]), /down/);
  assert.equal(calls, 1);
  await assert.rejects(shared('mail', load), /down/);
  assert.equal(calls, 2);
});

test('different keys don’t share', async () => {
  let calls = 0;
  const load = async () => { calls += 1; return calls; };
  await Promise.all([shared('a', load), shared('b', load)]);
  assert.equal(calls, 2);
});
