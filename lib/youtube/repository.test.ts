import { test, vi } from 'vitest';
import assert from 'node:assert/strict';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/locale/repository', () => ({ getPersonSettingsAdmin: async () => ({ timeZone: 'Asia/Kolkata' }) }));

import { lastScheduledAt } from './repository.ts';

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
