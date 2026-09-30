import 'server-only';

import { CredentialCryptoError, decryptCredential, encryptCredential } from '@/lib/crypto/credentials';
import { createAdminClient } from '@/lib/supabase/admin';
import { isMissingTable } from '@/lib/supabase/errors';
import type { SocialPlatformId, SocialSession } from '@/lib/social/meta';

export type SocialConnectionStatus = {
  platform: SocialPlatformId;
  username: string | null;
  status: 'connected' | 'reconnect_required';
  expiresAt: string | null;
  lastPublishedAt: string | null;
};

/** What Settings shows, with no token in it. */
export async function getSocialConnections(userId: string): Promise<{ ready: boolean; items: SocialConnectionStatus[] }> {
  try {
    const { data, error } = await createAdminClient()
      .from('social_connections')
      .select('platform,username,status,expires_at,last_published_at')
      .eq('user_id', userId);
    if (error) return { ready: !isMissingTable(error), items: [] };
    return {
      ready: true,
      items: (data ?? []).map((row) => {
        // A token past its expiry cannot be refreshed, so it is reported as
        // needing a reconnect rather than as connected but broken.
        const expired = row.expires_at ? new Date(row.expires_at).getTime() <= Date.now() : false;
        return {
          platform: row.platform as SocialPlatformId,
          username: row.username,
          status: expired || row.status === 'reconnect_required' ? 'reconnect_required' : 'connected',
          expiresAt: row.expires_at,
          lastPublishedAt: row.last_published_at,
        };
      }),
    };
  } catch {
    return { ready: false, items: [] };
  }
}

/** The token itself, for publishing. Server-only by construction. */
export async function getSocialToken(userId: string, platform: SocialPlatformId) {
  const { data, error } = await createAdminClient()
    .from('social_connections')
    .select('access_token_encrypted,account_id,expires_at,status')
    .eq('user_id', userId)
    .eq('platform', platform)
    .maybeSingle();
  if (error || !data) return null;
  if (data.status === 'reconnect_required') return null;
  if (data.expires_at && new Date(data.expires_at).getTime() <= Date.now()) return null;
  try {
    return { accessToken: decryptCredential(data.access_token_encrypted), accountId: String(data.account_id) };
  } catch (error) {
    if (error instanceof CredentialCryptoError) return null;
    return null;
  }
}

export async function saveSocialConnection(userId: string, platform: SocialPlatformId, session: SocialSession) {
  const { error } = await createAdminClient().from('social_connections').upsert({
    user_id: userId,
    platform,
    access_token_encrypted: encryptCredential(session.accessToken),
    account_id: session.accountId,
    username: session.username,
    expires_at: session.expiresAt?.toISOString() ?? null,
    status: 'connected',
  }, { onConflict: 'user_id,platform' });
  if (error) throw new Error(isMissingTable(error) ? 'Apply the social connections migration in Supabase, then try again.' : 'That connection could not be saved.');
}

export async function markSocialReconnect(userId: string, platform: SocialPlatformId) {
  try {
    await createAdminClient().from('social_connections').update({ status: 'reconnect_required' }).eq('user_id', userId).eq('platform', platform);
  } catch {
    // Status bookkeeping must not break a publish response.
  }
}

export async function recordSocialPublish(userId: string, platform: SocialPlatformId) {
  try {
    await createAdminClient().from('social_connections').update({ last_published_at: new Date().toISOString() }).eq('user_id', userId).eq('platform', platform);
  } catch {
    // Bookkeeping only.
  }
}

export async function deleteSocialConnection(userId: string, platform: SocialPlatformId) {
  const { error } = await createAdminClient().from('social_connections').delete().eq('user_id', userId).eq('platform', platform);
  if (error) throw new Error('That connection could not be removed.');
}
