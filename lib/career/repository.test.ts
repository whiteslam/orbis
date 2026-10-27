import { test, vi } from 'vitest';
import assert from 'node:assert/strict';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => null }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => null }));

const { deferCareerUsers } = await import('./repository.ts');
type Db = Parameters<typeof deferCareerUsers>[0];

/** Records the one update a deferral makes. */
function fakeDb(result: { error: unknown } | Error = { error: null }) {
  const calls: Array<{ table: string; values: unknown; column: string; ids: unknown }> = [];
  const db = {
    from: (table: string) => ({
      update: (values: unknown) => ({
        in: async (column: string, ids: unknown) => {
          calls.push({ table, values, column, ids });
          if (result instanceof Error) throw result;
          return result;
        },
      }),
    }),
  };
  return { db: db as unknown as Db, calls };
}

test('refused people are stamped in one update, so they rotate behind the admitted', async () => {
  const { db, calls } = fakeDb();
  await deferCareerUsers(db, 'ingest', ['u1', 'u2'], '2026-10-28T00:00:00.000Z');
  await deferCareerUsers(db, 'mail', ['u3'], '2026-10-28T00:00:00.000Z');
  assert.deepEqual(calls, [
    { table: 'career_profiles', values: { last_ingest_at: '2026-10-28T00:00:00.000Z' }, column: 'user_id', ids: ['u1', 'u2'] },
    { table: 'career_profiles', values: { last_mail_scan_at: '2026-10-28T00:00:00.000Z' }, column: 'user_id', ids: ['u3'] },
  ]);
});

test('no one refused, no update; a failed update never stops the run', async () => {
  const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const { db, calls } = fakeDb();
  await deferCareerUsers(db, 'ingest', [], 'x');
  assert.equal(calls.length, 0);
  await deferCareerUsers(fakeDb({ error: { message: 'down' } }).db, 'ingest', ['u1'], 'x');
  await deferCareerUsers(fakeDb(new Error('network')).db, 'mail', ['u1'], 'x');
  assert.equal(quiet.mock.calls.length, 2);
  quiet.mockRestore();
});
