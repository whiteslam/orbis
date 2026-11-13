import { test, vi } from 'vitest';
import assert from 'node:assert/strict';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/locale/repository', () => ({ getPersonSettingsAdmin: async () => ({ timeZone: 'Asia/Kolkata' }) }));

import { ALREADY_QUEUED, getSchedule, lastScheduledAt, removeQueued, retryFailed, YouTubeQueueError, YouTubeReadError } from './repository.ts';

type Filters = Record<string, unknown>;

// Just enough of the query builder for lastScheduledAt: each query records its
// eq filters and is answered by `answer` from them.
function fakeAdmin(answer: (filters: Filters, columns: string) => { data: unknown[] | null; error: { code?: string } | null }) {
  const queries: { columns: string; filters: Filters }[] = [];
  const from = () => ({
    select(columns: string) {
      const query = { columns, filters: {} as Filters };
      queries.push(query);
      const chain: Record<string, unknown> = {};
      chain.eq = (column: string, value: unknown) => { query.filters[column] = value; return chain; };
      chain.not = () => chain;
      chain.order = () => chain;
      chain.limit = () => chain;
      chain.maybeSingle = async () => {
        const { data, error } = answer(query.filters, columns);
        return { data: data?.[0] ?? null, error };
      };
      chain.then = (resolve: (value: unknown) => void) => resolve(answer(query.filters, columns));
      return chain;
    },
  });
  return { admin: { from } as unknown as Parameters<typeof lastScheduledAt>[0], queries };
}

const USER = '11111111-1111-4111-8111-111111111111';

test('a scheduled row that failed for good uses the day’s slot, when it is the later', async () => {
  const { admin, queries } = fakeAdmin((filters) => {
    if (filters.status === 'published') return { data: [{ published_at: '2026-11-12T12:30:00+00:00' }], error: null };
    return { data: [{ updated_at: '2026-11-13T12:40:00+00:00' }], error: null };
  });
  assert.equal(await lastScheduledAt(admin, USER), '2026-11-13T12:40:00+00:00');
  // Both queries are the schedule's own, for this person only.
  assert.deepEqual(queries.map((query) => query.filters), [
    { user_id: USER, status: 'published', posted_by: 'schedule' },
    { user_id: USER, status: 'failed', posted_by: 'schedule' },
  ]);
});

test('a later publish wins over an older failure, and nothing at all is null', async () => {
  const later = fakeAdmin((filters) =>
    filters.status === 'published' ? { data: [{ published_at: '2026-11-13T12:30:00+00:00' }], error: null } : { data: [{ updated_at: '2026-11-10T12:40:00+00:00' }], error: null });
  assert.equal(await lastScheduledAt(later.admin, USER), '2026-11-13T12:30:00+00:00');
  const none = fakeAdmin(() => ({ data: [], error: null }));
  assert.equal(await lastScheduledAt(none.admin, USER), null);
});

test('a missing table reads as never posted', async () => {
  const { admin } = fakeAdmin(() => ({ data: null, error: { code: '42P01' } }));
  assert.equal(await lastScheduledAt(admin, USER), null);
});

test('the publisher’s strict read of the last scheduled post throws on a failed read', async () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  const { admin } = fakeAdmin((filters) =>
    filters.status === 'published' ? { data: null, error: { code: '57014' } } : { data: [], error: null });
  // The panel's lenient read carries on; the publisher's never guesses.
  assert.equal(await lastScheduledAt(admin, USER), null);
  await assert.rejects(lastScheduledAt(admin, USER, { strict: true }), YouTubeReadError);
  // A missing table is still "never posted", strict or not.
  const missing = fakeAdmin(() => ({ data: null, error: { code: '42P01' } }));
  assert.equal(await lastScheduledAt(missing.admin, USER, { strict: true }), null);
  errors.mockRestore();
});

test('the publisher’s strict schedule read throws on a failed read; the panel’s falls back', async () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  const { admin } = fakeAdmin(() => ({ data: null, error: { code: '57014' } }));
  assert.equal((await getSchedule(admin, USER)).paused, false);
  await assert.rejects(getSchedule(admin, USER, { strict: true }), YouTubeReadError);
  const saved = fakeAdmin(() => ({ data: [{ post_time: '18:00', days: [1, 2, 3, 4, 5, 6, 7], timezone: 'Asia/Kolkata', paused: true, hold_until: null }], error: null }));
  assert.equal((await getSchedule(saved.admin, USER, { strict: true })).paused, true);
  errors.mockRestore();
});

type Update = { patch: Record<string, unknown>; eq: Filters; in: Record<string, unknown[]>; or: string[] };

// Just enough of the builder for a guarded update: it records the patch and every filter.
function fakeUpdates(answer: (update: Update) => { data: unknown[] | null; error: { code?: string } | null }, firstPosition: number | null = 1) {
  const updates: Update[] = [];
  const from = () => ({
    update(patch: Record<string, unknown>) {
      const update: Update = { patch, eq: {}, in: {}, or: [] };
      updates.push(update);
      const chain: Record<string, unknown> = {};
      chain.eq = (column: string, value: unknown) => { update.eq[column] = value; return chain; };
      chain.in = (column: string, values: unknown[]) => { update.in[column] = values; return chain; };
      chain.or = (filter: string) => { update.or.push(filter); return chain; };
      chain.select = () => chain;
      chain.then = (resolve: (value: unknown) => void) => resolve(answer(update));
      return chain;
    },
    select() {
      const chain: Record<string, unknown> = {};
      chain.eq = () => chain;
      chain.order = () => chain;
      chain.limit = () => chain;
      chain.then = (resolve: (value: unknown) => void) => resolve({ data: firstPosition === null ? [] : [{ position: firstPosition }], error: null });
      return chain;
    },
  });
  return { admin: { from } as unknown as Parameters<typeof removeQueued>[0], updates };
}

test('Remove takes out a waiting, failed or stranded uploading row, but never one under a lease', async () => {
  const { admin, updates } = fakeUpdates(() => ({ data: [{ id: 'row-1' }], error: null }));
  const before = Date.now();
  assert.equal(await removeQueued(admin, USER, 'row-1'), true);
  const [update] = updates;
  assert.deepEqual(update.patch, { status: 'removed', upload_url: null, bytes_sent: 0 });
  assert.deepEqual(update.eq, { user_id: USER, id: 'row-1' });
  assert.deepEqual(update.in.status, ['queued', 'failed', 'uploading']);
  // Only when no slice holds it: the lease is empty or already run out.
  assert.equal(update.or.length, 1);
  const match = /^lease_until\.is\.null,lease_until\.lt\.(.+)$/.exec(update.or[0]);
  assert.ok(match, update.or[0]);
  const cutoff = Date.parse(match[1]);
  assert.ok(cutoff >= before - 1 && cutoff <= Date.now() + 1);
});

test('Remove on a row a slice holds changes nothing', async () => {
  const { admin } = fakeUpdates(() => ({ data: [], error: null }));
  assert.equal(await removeQueued(admin, USER, 'row-1'), false);
});

test('Retry on a short that is queued again says so', async () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  const { admin } = fakeUpdates(() => ({ data: null, error: { code: '23505' } }));
  await assert.rejects(retryFailed(admin, USER, 'row-1'), (error: unknown) => error instanceof YouTubeQueueError && error.message === ALREADY_QUEUED);
  errors.mockRestore();
});
