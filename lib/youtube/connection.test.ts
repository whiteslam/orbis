import { beforeEach, test, vi } from 'vitest';
import assert from 'node:assert/strict';

vi.mock('server-only', () => ({}));

type Row = Record<string, unknown>;
const state: { stored: Row | null; gmail: Row | null; upserts: Row[]; upsertErrors: { code: string }[]; deleted: boolean; failDelete: boolean; readError: { code: string } | null } = { stored: null, gmail: null, upserts: [], upsertErrors: [], deleted: false, failDelete: false, readError: null };

// Just enough of the Supabase query builder for this file: a single row per person.
function fakeAdmin() {
  const builder = (table: string, op: 'select' | 'update' | 'delete' | 'upsert', payload?: Row) => {
    const chain: Record<string, unknown> = {};
    chain.eq = () => chain;
    chain.select = () => chain;
    chain.maybeSingle = async () => (state.readError ? { data: null, error: state.readError } : { data: table === 'gmail_connections' ? state.gmail : state.stored, error: null });
    chain.then = (resolve: (value: unknown) => void) => {
      if (op === 'upsert') state.upserts.push(payload!);
      if (op === 'update' && state.stored) state.stored = { ...state.stored, ...payload };
      if (op === 'delete' && !state.failDelete) state.deleted = true;
      if (op === 'upsert') return resolve({ error: state.upsertErrors.shift() ?? null });
      resolve({ error: op === 'delete' && state.failDelete ? { message: 'no' } : null });
    };
    return chain;
  };
  return { from: (table: string) => ({ select: () => builder(table, 'select'), update: (p: Row) => builder(table, 'update', p), delete: () => builder(table, 'delete'), upsert: (p: Row) => builder(table, 'upsert', p) }) };
}

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => fakeAdmin() }));

const revoked: string[] = [];
vi.mock('./google.ts', async () => {
  const actual = await vi.importActual<typeof import('./google.ts')>('./google.ts');
  return { ...actual, revokeGoogleToken: async (token: string) => { revoked.push(token); } };
});

import { decryptCredential, encryptCredential } from '@/lib/crypto/credentials';
import { YouTubeAuthError } from './google.ts';
import { disconnectYouTube, getYouTubeConnection, getYouTubeRefreshToken, markYouTubeReconnect, saveYouTubeConnection } from './connection.ts';

type Admin = Parameters<typeof getYouTubeConnection>[0];
const admin = () => fakeAdmin() as unknown as Admin;

beforeEach(() => {
  process.env.CREDENTIAL_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
  state.stored = null; state.gmail = null; state.upserts = []; state.upsertErrors = []; state.deleted = false; state.failDelete = false; state.readError = null; revoked.length = 0;
});

test('saving stores both tokens encrypted, the channel id, a trimmed title and no expiry', async () => {
  await saveYouTubeConnection('u1', { id: 'UC1', title: `  ${'T'.repeat(80)}  ` }, { accessToken: 'at', refreshToken: 'rt' });
  const row = state.upserts[0]!;
  assert.equal(row.user_id, 'u1');
  assert.equal(row.platform, 'youtube');
  assert.equal(row.account_id, 'UC1');
  assert.equal(row.username, 'T'.repeat(64));
  assert.equal(row.expires_at, null);
  assert.equal(row.status, 'connected');
  assert.equal(decryptCredential(row.access_token_encrypted as string), 'at');
  assert.equal(decryptCredential(row.refresh_token_encrypted as string), 'rt');
  assert.equal(typeof row.connected_at, 'string');
});

test('saving stamps connected_at with the time of the connect', async () => {
  const before = Date.now();
  await saveYouTubeConnection('u1', { id: 'UC1', title: 'T' }, { accessToken: 'at', refreshToken: 'rt' });
  const stamped = Date.parse(state.upserts[0]!.connected_at as string);
  assert.ok(stamped >= before && stamped <= Date.now());
});

test('before the connected_at column exists, it saves again without it', async () => {
  state.upsertErrors = [{ code: '42703' }];
  await saveYouTubeConnection('u1', { id: 'UC1', title: 'T' }, { accessToken: 'at', refreshToken: 'rt' });
  assert.equal(state.upserts.length, 2);
  assert.equal('connected_at' in state.upserts[1]!, false);
  assert.equal(state.upserts[1]!.status, 'connected');
});

test('with no new refresh token, the stored one is kept for the same channel', async () => {
  const kept = encryptCredential('old-rt');
  state.stored = { account_id: 'UC1', refresh_token_encrypted: kept };
  await saveYouTubeConnection('u1', { id: 'UC1', title: 'T' }, { accessToken: 'at', refreshToken: null });
  assert.equal(state.upserts[0]!.refresh_token_encrypted, kept);
});

test('with no refresh token and a different channel, it asks to connect again and stores nothing', async () => {
  state.stored = { account_id: 'UC1', refresh_token_encrypted: encryptCredential('old-rt') };
  await assert.rejects(() => saveYouTubeConnection('u1', { id: 'UC2', title: 'T' }, { accessToken: 'at', refreshToken: null }), (error: unknown) => error instanceof YouTubeAuthError && /offline access/.test(error.message));
  state.stored = null;
  await assert.rejects(() => saveYouTubeConnection('u1', { id: 'UC2', title: 'T' }, { accessToken: 'at', refreshToken: null }), YouTubeAuthError);
  assert.equal(state.upserts.length, 0);
});

test('the refresh token is returned only for a healthy, readable connection', async () => {
  state.stored = { refresh_token_encrypted: encryptCredential('rt'), status: 'connected' };
  assert.equal(await getYouTubeRefreshToken(admin(), 'u1'), 'rt');
  state.stored = { refresh_token_encrypted: encryptCredential('rt'), status: 'reconnect_required' };
  assert.equal(await getYouTubeRefreshToken(admin(), 'u1'), null);
  state.stored = { refresh_token_encrypted: 'garbage', status: 'connected' };
  assert.equal(await getYouTubeRefreshToken(admin(), 'u1'), null);
  state.stored = { refresh_token_encrypted: null, status: 'connected' };
  assert.equal(await getYouTubeRefreshToken(admin(), 'u1'), null);
  state.stored = null;
  assert.equal(await getYouTubeRefreshToken(admin(), 'u1'), null);
});

test('the connection shows the channel title and status, and nothing else', async () => {
  assert.equal(await getYouTubeConnection(admin(), 'u1'), null);
  state.stored = { username: 'My Channel', status: 'connected', refresh_token_encrypted: 'x' };
  assert.deepEqual(await getYouTubeConnection(admin(), 'u1'), { channelTitle: 'My Channel', status: 'connected' });
  await markYouTubeReconnect(admin(), 'u1');
  assert.deepEqual(await getYouTubeConnection(admin(), 'u1'), { channelTitle: 'My Channel', status: 'reconnect_required' });
});

test('disconnecting revokes the refresh token, then deletes the row', async () => {
  state.stored = { refresh_token_encrypted: encryptCredential('rt'), status: 'reconnect_required' };
  await disconnectYouTube('u1');
  assert.deepEqual(revoked, ['rt']);
  assert.equal(state.deleted, true);
});

test('disconnecting still deletes when the token cannot be read, and says so when the delete fails', async () => {
  state.stored = { refresh_token_encrypted: 'garbage', status: 'connected' };
  await disconnectYouTube('u1');
  assert.deepEqual(revoked, []);
  assert.equal(state.deleted, true);
  state.failDelete = true;
  await assert.rejects(() => disconnectYouTube('u1'), /could not be removed/);
});

test('disconnecting leaves the shared Google grant alone while Gmail is connected, but still deletes the row', async () => {
  state.stored = { refresh_token_encrypted: encryptCredential('rt'), status: 'connected' };
  state.gmail = { id: 'g1' };
  await disconnectYouTube('u1');
  assert.deepEqual(revoked, []);
  assert.equal(state.deleted, true);
});

test('connecting before the migration asks for it, whether the table or only its new columns are missing', async () => {
  for (const code of ['42703', '42P01']) {
    state.readError = { code };
    await assert.rejects(
      saveYouTubeConnection('u1', { id: 'UC1', title: 'T' }, { accessToken: 'at', refreshToken: 'rt' }),
      /Apply the YouTube migration in Supabase/,
    );
  }
  state.readError = { code: '57014' };
  await assert.rejects(saveYouTubeConnection('u1', { id: 'UC1', title: 'T' }, { accessToken: 'at', refreshToken: 'rt' }), /That connection could not be saved/);
});
