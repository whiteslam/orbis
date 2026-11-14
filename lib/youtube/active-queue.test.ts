import { test, vi } from 'vitest';
import assert from 'node:assert/strict';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/locale/repository', () => ({ getPersonSettingsAdmin: async () => ({ timeZone: 'Asia/Kolkata' }) }));

import { activeQueueFor, hasActiveQueue } from './repository.ts';

type Call = { eq: Record<string, unknown>; in: Record<string, unknown[]> };
type Answer = { data: unknown[] | null; error: { code?: string } | null };

// Just enough of the query builder for the two readers: records the filters and answers from them.
function fakeAdmin(answer: (call: Call) => Answer) {
  const calls: Call[] = [];
  const from = () => ({
    select() {
      const call: Call = { eq: {}, in: {} };
      calls.push(call);
      const chain: Record<string, unknown> = {};
      chain.eq = (column: string, value: unknown) => { call.eq[column] = value; return chain; };
      chain.in = (column: string, values: unknown[]) => { call.in[column] = values; return chain; };
      chain.limit = () => chain;
      chain.then = (resolve: (value: unknown) => void) => resolve(answer(call));
      return chain;
    },
  });
  return { admin: { from } as unknown as Parameters<typeof hasActiveQueue>[0], calls };
}

const USER = '11111111-1111-4111-8111-111111111111';
const JOB = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';

test('hasActiveQueue asks for this person’s queued or uploading row for the short', async () => {
  const { admin, calls } = fakeAdmin(() => ({ data: [{ id: 'row' }], error: null }));
  assert.equal(await hasActiveQueue(admin, USER, JOB), true);
  assert.equal(calls[0].eq.user_id, USER);
  assert.equal(calls[0].eq.job_id, JOB);
  assert.deepEqual(calls[0].in.status, ['queued', 'uploading']);
});

test('hasActiveQueue is false when nothing is waiting, and for a published row (not asked for)', async () => {
  const { admin } = fakeAdmin(() => ({ data: [], error: null }));
  assert.equal(await hasActiveQueue(admin, USER, JOB), false);
});

test('hasActiveQueue is false when the tables are missing (migration not applied)', async () => {
  const { admin } = fakeAdmin(() => ({ data: null, error: { code: '42P01' } }));
  assert.equal(await hasActiveQueue(admin, USER, JOB), false);
});

test('hasActiveQueue refuses to guess when the read fails for another reason', async () => {
  const { admin } = fakeAdmin(() => ({ data: null, error: { code: 'XX000' } }));
  await assert.rejects(hasActiveQueue(admin, USER, JOB));
});

test('activeQueueFor maps each short to its state and keeps only this person’s ids asked for', async () => {
  const { admin, calls } = fakeAdmin(() => ({
    data: [
      { job_id: JOB, status: 'published', youtube_id: 'abc123' },
      { job_id: OTHER, status: 'queued', youtube_id: null },
      { job_id: null, status: 'queued', youtube_id: null },
      { job_id: JOB, status: 'weird', youtube_id: null },
    ],
    error: null,
  }));
  assert.deepEqual(await activeQueueFor(admin, USER, [JOB, OTHER]), {
    [JOB]: { status: 'published', youtubeId: 'abc123' },
    [OTHER]: { status: 'queued', youtubeId: null },
  });
  assert.equal(calls[0].eq.user_id, USER);
  assert.deepEqual(calls[0].in.status, ['queued', 'uploading', 'published']);
});

test('activeQueueFor asks nothing for no shorts, and gives {} when the tables are missing', async () => {
  const none = fakeAdmin(() => ({ data: [], error: null }));
  assert.deepEqual(await activeQueueFor(none.admin, USER, []), {});
  assert.equal(none.calls.length, 0);
  const missing = fakeAdmin(() => ({ data: null, error: { code: '42P01' } }));
  assert.deepEqual(await activeQueueFor(missing.admin, USER, [JOB]), {});
});

test('activeQueueFor asks in chunks, so a long library does not make a huge query', async () => {
  const ids = Array.from({ length: 250 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
  const { admin, calls } = fakeAdmin(() => ({ data: [], error: null }));
  await activeQueueFor(admin, USER, ids);
  assert.deepEqual(calls.map((call) => call.in.job_id.length), [100, 100, 50]);
});
