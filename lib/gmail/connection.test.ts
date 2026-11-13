import { beforeEach, test, vi } from 'vitest';
import assert from 'node:assert/strict';

vi.mock('server-only', () => ({}));

type Row = Record<string, unknown>;
const state: { gmail: Row | null; youtube: Row | null; youtubeError: { code: string } | null; deleted: boolean } = { gmail: null, youtube: null, youtubeError: null, deleted: false };

// Just enough of the Supabase query builder: one row per table for this person.
function fakeAdmin() {
  const builder = (table: string, op: 'select' | 'delete') => {
    const chain: Record<string, unknown> = {};
    chain.eq = () => chain;
    chain.maybeSingle = async () => (table === 'social_connections' ? { data: state.youtube, error: state.youtubeError } : { data: state.gmail, error: null });
    chain.then = (resolve: (value: unknown) => void) => {
      if (op === 'delete') state.deleted = true;
      resolve({ error: null });
    };
    return chain;
  };
  return { from: (table: string) => ({ select: () => builder(table, 'select'), delete: () => builder(table, 'delete') }) };
}

const revoked: string[] = [];
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => fakeAdmin() }));
vi.mock('@/lib/gmail/crypto', () => ({ decryptRefreshToken: (value: string) => `plain-${value}` }));
vi.mock('@/lib/gmail/oauth', () => ({
  GoogleOAuthError: class extends Error {},
  refreshGoogleAccessToken: async () => ({ access_token: 'at' }),
  revokeGoogleToken: async (token: string) => { revoked.push(token); return true; },
}));

import { disconnectGmail } from './connection.ts';

beforeEach(() => {
  state.gmail = { id: 'g1', refresh_token_encrypted: 'enc' };
  state.youtube = null;
  state.youtubeError = null;
  state.deleted = false;
  revoked.length = 0;
});

test('disconnecting Gmail revokes the grant when YouTube is not connected', async () => {
  assert.deepEqual(await disconnectGmail('u1'), { revoked: true, sharedWithYouTube: false });
  assert.deepEqual(revoked, ['plain-enc']);
  assert.equal(state.deleted, true);
});

test('disconnecting Gmail leaves the shared Google grant alone while YouTube is connected, but still deletes the row', async () => {
  state.youtube = { platform: 'youtube' };
  assert.deepEqual(await disconnectGmail('u1'), { revoked: false, sharedWithYouTube: true });
  assert.deepEqual(revoked, []);
  assert.equal(state.deleted, true);
});

test('if YouTube cannot be checked, the grant is left alone rather than risk breaking it', async () => {
  state.youtubeError = { code: 'XX000' };
  assert.deepEqual(await disconnectGmail('u1'), { revoked: false, sharedWithYouTube: true });
  assert.deepEqual(revoked, []);
});

test('a missing social_connections table means YouTube is not connected', async () => {
  state.youtubeError = { code: '42P01' };
  assert.deepEqual(await disconnectGmail('u1'), { revoked: true, sharedWithYouTube: false });
});
