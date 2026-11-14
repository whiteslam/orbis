import 'server-only';

import { decryptCredential, encryptCredential } from '@/lib/crypto/credentials';
import { createAdminClient } from '@/lib/supabase/admin';
import { isMissingTable } from '@/lib/supabase/errors';
import { revokeGoogleToken, YouTubeAuthError } from '@/lib/youtube/google';
import type { YouTubeConnection } from '@/lib/youtube/types';

// The YouTube row in social_connections. The refresh token is the long-lived
// credential; the access token stored beside it is only the first one Google
// issued, and publishing mints a fresh one each run.

type Admin = ReturnType<typeof createAdminClient>;

const TITLE_MAX = 64;
const APPLY_MIGRATION = 'Apply the YouTube migration in Supabase, then try again.';

/** The table, or the columns the YouTube migration adds to it (42703, undefined column), aren't there yet. */
const beforeMigration = (error: { code?: string }) => isMissingTable(error) || error.code === '42703';

export async function saveYouTubeConnection(
  userId: string,
  channel: { id: string; title: string },
  tokens: { accessToken: string; refreshToken: string | null },
) {
  const admin = createAdminClient();
  const { data: existing, error: readError } = await admin
    .from('social_connections')
    .select('account_id,refresh_token_encrypted')
    .eq('user_id', userId)
    .eq('platform', 'youtube')
    .maybeSingle();
  if (readError) throw new Error(beforeMigration(readError) ? APPLY_MIGRATION : 'That connection could not be saved.');

  // Google only sends a refresh token when it asks for consent afresh. Without
  // one, the stored token is still good if it belongs to the same channel.
  let refreshEncrypted: string;
  if (tokens.refreshToken) {
    refreshEncrypted = encryptCredential(tokens.refreshToken);
  } else if (existing?.account_id === channel.id && typeof existing.refresh_token_encrypted === 'string' && existing.refresh_token_encrypted) {
    refreshEncrypted = existing.refresh_token_encrypted;
  } else {
    throw new YouTubeAuthError('Google didn’t give Orbis offline access. Connect again and allow access.');
  }

  const values = {
    user_id: userId,
    platform: 'youtube',
    access_token_encrypted: encryptCredential(tokens.accessToken),
    refresh_token_encrypted: refreshEncrypted,
    account_id: channel.id,
    username: [...channel.title.trim()].slice(0, TITLE_MAX).join(''),
    expires_at: null,
    status: 'connected',
  };
  // connected_at tells a 7-day Google expiry from other disconnects. Before its
  // migration (202611140002), the connection is saved without it.
  let { error } = await admin.from('social_connections').upsert({ ...values, connected_at: new Date().toISOString() }, { onConflict: 'user_id,platform' });
  if (error?.code === 'PGRST204' || error?.code === '42703') ({ error } = await admin.from('social_connections').upsert(values, { onConflict: 'user_id,platform' }));
  if (error) throw new Error(beforeMigration(error) ? APPLY_MIGRATION : 'That connection could not be saved.');
}

/** What the screens show: the channel and whether it still works. No token in it. */
export async function getYouTubeConnection(admin: Admin, userId: string): Promise<YouTubeConnection> {
  const { data, error } = await admin
    .from('social_connections')
    .select('username,status')
    .eq('user_id', userId)
    .eq('platform', 'youtube')
    .maybeSingle();
  if (error || !data) return null;
  return { channelTitle: data.username, status: data.status === 'reconnect_required' ? 'reconnect_required' : 'connected' };
}

/** The refresh token, or null when there is none to use: missing, needs a reconnect, or unreadable. */
export async function getYouTubeRefreshToken(admin: Admin, userId: string): Promise<string | null> {
  const { data, error } = await admin
    .from('social_connections')
    .select('refresh_token_encrypted,status')
    .eq('user_id', userId)
    .eq('platform', 'youtube')
    .maybeSingle();
  if (error || !data || data.status === 'reconnect_required' || !data.refresh_token_encrypted) return null;
  try {
    return decryptCredential(data.refresh_token_encrypted);
  } catch {
    return null;
  }
}

export async function markYouTubeReconnect(admin: Admin, userId: string) {
  try {
    await admin.from('social_connections').update({ status: 'reconnect_required' }).eq('user_id', userId).eq('platform', 'youtube');
  } catch {
    // Status bookkeeping must not break a publish run.
  }
}

export async function recordYouTubePublish(admin: Admin, userId: string) {
  try {
    await admin.from('social_connections').update({ last_published_at: new Date().toISOString() }).eq('user_id', userId).eq('platform', 'youtube');
  } catch {
    // Bookkeeping only.
  }
}

/** True when this person has a Gmail row, whatever its status. A read that fails other than for a missing table counts as yes, the safe answer. */
async function hasGmailConnection(admin: Admin, userId: string) {
  const { data, error } = await admin.from('gmail_connections').select('id').eq('user_id', userId).maybeSingle();
  if (error) return !isMissingTable(error);
  return Boolean(data);
}

/** Revokes Orbis's access at Google (best effort, and only when Gmail isn't using it too), then removes the row. */
export async function disconnectYouTube(userId: string) {
  const admin = createAdminClient();
  const gmailStillConnected = await hasGmailConnection(admin, userId);
  const { data } = await admin
    .from('social_connections')
    .select('refresh_token_encrypted')
    .eq('user_id', userId)
    .eq('platform', 'youtube')
    .maybeSingle();
  // Gmail uses the same Google client, and Google keeps one grant per account
  // per client: revoking it here would also kill Gmail's refresh token. So the
  // grant is only withdrawn when Gmail isn't connected; the row goes either way.
  if (data?.refresh_token_encrypted && !gmailStillConnected) {
    try {
      await revokeGoogleToken(decryptCredential(data.refresh_token_encrypted));
    } catch {
      // An unreadable token can't be revoked; the person can remove Orbis in their Google account.
    }
  }
  const { error } = await admin.from('social_connections').delete().eq('user_id', userId).eq('platform', 'youtube');
  // No table means no row to remove (the migration isn't applied), which must not block deleting an account.
  if (error && !isMissingTable(error)) throw new Error('That connection could not be removed.');
}
