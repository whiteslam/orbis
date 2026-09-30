import 'server-only';

import { decryptCredential, encryptCredential } from '@/lib/crypto/credentials';
import { callMeta, MetaError } from '@/lib/meta/client';
import { refreshToken } from '@/lib/meta/requests';
import { needsRefresh, parseLongToken } from '@/lib/meta/tokens';
import type { ConnectionSummary, MetaPlatform } from '@/lib/meta/types';
import { createAdminClient } from '@/lib/supabase/admin';

const MISSING_TABLE = ['PGRST205', 'PGRST204', '42P01'];

/** Which platforms are connected, with no token. Empty if the migration is not applied yet. */
export async function listConnections(userId: string): Promise<ConnectionSummary[]> {
  const { data, error } = await createAdminClient().from('social_connections').select('platform,username,status').eq('user_id', userId);
  if (error) {
    if (!MISSING_TABLE.includes(error.code ?? '')) console.error('Loading Meta connections failed', error.code);
    return [];
  }
  return (data ?? []).map((row) => ({ platform: row.platform, username: row.username, status: row.status }));
}

export async function saveConnection(userId: string, platform: MetaPlatform, input: { accountId: string; username: string; accessToken: string; expiresAt: string }) {
  const { error } = await createAdminClient().from('social_connections').upsert({
    user_id: userId, platform, account_id: input.accountId, username: input.username.slice(0, 64),
    access_token_encrypted: encryptCredential(input.accessToken), expires_at: input.expiresAt, status: 'connected',
  }, { onConflict: 'user_id,platform' });
  if (error) throw new Error(`Saving the ${platform} connection failed (${error.code}).`);
}

export async function deleteConnection(userId: string, platform: MetaPlatform) {
  const { error } = await createAdminClient().from('social_connections').delete().eq('user_id', userId).eq('platform', platform);
  if (error) throw new Error(`Removing the ${platform} connection failed (${error.code}).`);
}

export async function markReconnect(userId: string, platform: MetaPlatform) {
  await createAdminClient().from('social_connections').update({ status: 'reconnect_required' }).eq('user_id', userId).eq('platform', platform);
}

/**
 * A token ready to use, refreshed first when it has under a week left. A
 * refresh that fails while the old token still works is not an error (Meta
 * refuses to refresh tokens under a day old); an expired token is a reconnect.
 */
export async function usableToken(userId: string, platform: MetaPlatform): Promise<{ accountId: string; username: string; token: string } | { error: 'none' | 'reconnect' }> {
  const admin = createAdminClient();
  const { data, error } = await admin.from('social_connections').select('account_id,username,access_token_encrypted,expires_at,status').eq('user_id', userId).eq('platform', platform).maybeSingle();
  if (error || !data) return { error: 'none' };
  if (data.status === 'reconnect_required') return { error: 'reconnect' };
  const now = new Date();
  if (new Date(data.expires_at) <= now) {
    await markReconnect(userId, platform);
    return { error: 'reconnect' };
  }
  let token = decryptCredential(data.access_token_encrypted);
  if (needsRefresh(data.expires_at, now)) {
    try {
      const fresh = parseLongToken(await callMeta(refreshToken(platform, token)), now);
      if (fresh) {
        await admin.from('social_connections').update({ access_token_encrypted: encryptCredential(fresh.accessToken), expires_at: fresh.expiresAt }).eq('user_id', userId).eq('platform', platform);
        token = fresh.accessToken;
      }
    } catch (caught) {
      if (caught instanceof MetaError && caught.kind === 'auth') {
        await markReconnect(userId, platform);
        return { error: 'reconnect' };
      }
    }
  }
  return { accountId: data.account_id, username: data.username, token };
}
