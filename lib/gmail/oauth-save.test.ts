import { beforeEach, test, vi } from 'vitest';
import assert from 'node:assert/strict';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/gmail/crypto', () => ({ encryptRefreshToken: (token: string) => `enc:${token}` }));

type Row = Record<string, unknown>;
const state: { upserts: Row[]; upsertErrors: { code: string }[] } = { upserts: [], upsertErrors: [] };

// Just enough of the Supabase query builder for saveGmailConnection: no row yet, then upserts.
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
      upsert: async (row: Row) => { state.upserts.push(row); return { error: state.upsertErrors.shift() ?? null }; },
    }),
  }),
}));

import { saveGmailConnection } from './oauth.ts';

beforeEach(() => { state.upserts = []; state.upsertErrors = []; });

const account = { sub: 'g1', email: 'me@example.com' };

test('saving a Gmail connection stamps connected_at', async () => {
  await saveGmailConnection('u1', account, 'rt', ['gmail.readonly']);
  assert.equal(state.upserts.length, 1);
  assert.equal(typeof state.upserts[0]!.connected_at, 'string');
  assert.deepEqual(state.upserts[0]!.granted_scopes, ['gmail.readonly']);
});

test('before the connected_at column exists, it saves with the scopes but without it', async () => {
  state.upsertErrors = [{ code: '42703' }];
  await saveGmailConnection('u1', account, 'rt', ['gmail.readonly']);
  assert.equal(state.upserts.length, 2);
  assert.equal('connected_at' in state.upserts[1]!, false);
  assert.deepEqual(state.upserts[1]!.granted_scopes, ['gmail.readonly']);
});
