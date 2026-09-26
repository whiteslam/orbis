import 'server-only';

import { CredentialCryptoError, decryptCredential, encryptCredential } from '@/lib/crypto/credentials';
import { createAdminClient } from '@/lib/supabase/admin';

export type StoredZerodhaSession = {
  accessToken: string;
  kiteUserId: string | null;
  expiresAt: Date;
  status: 'connected' | 'reconnect_required';
  lastSyncAt: string | null;
};

export type ZerodhaConnectionLookup =
  | { kind: 'connected'; session: StoredZerodhaSession }
  /** A session exists but Kite has ended it; the user logs in again. */
  | { kind: 'expired'; lastSyncAt: string | null }
  | { kind: 'none' }
  | { kind: 'setup'; message: string };

const isMissingTable = (code?: string) => ['PGRST205', 'PGRST204', '42P01'].includes(code ?? '');

export async function getZerodhaConnection(userId: string): Promise<ZerodhaConnectionLookup> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('zerodha_connections')
    .select('access_token_encrypted,kite_user_id,expires_at,status,last_sync_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    return {
      kind: 'setup',
      message: isMissingTable(error.code)
        ? 'Apply the Zerodha connections migration in Supabase to connect Zerodha.'
        : 'Your Zerodha connection could not be loaded. Try again shortly.',
    };
  }
  if (!data) return { kind: 'none' };

  const expiresAt = new Date(data.expires_at);
  // Checked here rather than at the API, so an overnight session is reported as
  // needing a login instead of surfacing as a failed request.
  if (data.status === 'reconnect_required' || Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
    return { kind: 'expired', lastSyncAt: data.last_sync_at };
  }

  try {
    return {
      kind: 'connected',
      session: {
        accessToken: decryptCredential(data.access_token_encrypted),
        kiteUserId: data.kite_user_id,
        expiresAt,
        status: data.status,
        lastSyncAt: data.last_sync_at,
      },
    };
  } catch (error) {
    return { kind: 'setup', message: error instanceof CredentialCryptoError ? error.message : 'Your Zerodha session could not be unlocked.' };
  }
}

export async function saveZerodhaSession(userId: string, input: { accessToken: string; kiteUserId: string; expiresAt: Date }) {
  const admin = createAdminClient();
  const { error } = await admin.from('zerodha_connections').upsert({
    user_id: userId,
    access_token_encrypted: encryptCredential(input.accessToken),
    kite_user_id: input.kiteUserId || null,
    expires_at: input.expiresAt.toISOString(),
    status: 'connected',
    last_sync_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });
  if (error) throw new Error(isMissingTable(error.code) ? 'Apply the Zerodha connections migration in Supabase, then try again.' : 'Your Zerodha session could not be saved.');
}

export async function markZerodhaReconnect(userId: string) {
  try {
    await createAdminClient().from('zerodha_connections').update({ status: 'reconnect_required' }).eq('user_id', userId);
  } catch {
    // Status bookkeeping must not break the holdings response.
  }
}

export async function deleteZerodhaConnection(userId: string) {
  const { error } = await createAdminClient().from('zerodha_connections').delete().eq('user_id', userId);
  if (error) throw new Error('Zerodha could not be disconnected. Try again.');
}
