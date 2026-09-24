import 'server-only';

import { CredentialCryptoError, decryptCredential, encryptCredential } from '@/lib/crypto/credentials';
import type { GrowwCredentials } from '@/lib/invest/groww';
import { createAdminClient } from '@/lib/supabase/admin';

export type StoredGrowwConnection = {
  credentials: GrowwCredentials;
  status: 'connected' | 'reconnect_required';
  lastSyncAt: string | null;
};

export type GrowwConnectionLookup =
  | { kind: 'connected'; connection: StoredGrowwConnection }
  | { kind: 'none' }
  | { kind: 'setup'; message: string };

const isMissingTable = (code?: string) => code === 'PGRST205' || code === 'PGRST204' || code === '42P01';

export async function getGrowwConnection(userId: string): Promise<GrowwConnectionLookup> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('groww_connections')
    .select('api_key_encrypted,api_secret_encrypted,status,last_sync_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    return isMissingTable(error.code)
      ? { kind: 'setup', message: 'Apply the Groww connections migration in Supabase to connect Groww.' }
      : { kind: 'setup', message: 'Your Groww connection could not be loaded. Try again shortly.' };
  }
  if (!data) return { kind: 'none' };
  try {
    return {
      kind: 'connected',
      connection: {
        credentials: { apiKey: decryptCredential(data.api_key_encrypted), apiSecret: decryptCredential(data.api_secret_encrypted) },
        status: data.status,
        lastSyncAt: data.last_sync_at,
      },
    };
  } catch (error) {
    return { kind: 'setup', message: error instanceof CredentialCryptoError ? error.message : 'Your Groww connection could not be unlocked.' };
  }
}

export async function saveGrowwConnection(userId: string, credentials: GrowwCredentials) {
  const admin = createAdminClient();
  const { error } = await admin.from('groww_connections').upsert({
    user_id: userId,
    api_key_encrypted: encryptCredential(credentials.apiKey),
    api_secret_encrypted: encryptCredential(credentials.apiSecret),
    status: 'connected',
    last_sync_at: new Date().toISOString(),
  });
  if (error) throw new Error(isMissingTable(error.code) ? 'Apply the Groww connections migration in Supabase, then try again.' : 'Your Groww connection could not be saved.');
}

export async function recordGrowwSync(userId: string, outcome: 'ok' | 'auth_failed') {
  try {
    const admin = createAdminClient();
    await admin.from('groww_connections')
      .update(outcome === 'ok' ? { status: 'connected', last_sync_at: new Date().toISOString() } : { status: 'reconnect_required' })
      .eq('user_id', userId);
  } catch {
    // Status bookkeeping must not break the holdings response.
  }
}

export async function deleteGrowwConnection(userId: string) {
  const admin = createAdminClient();
  const { error } = await admin.from('groww_connections').delete().eq('user_id', userId);
  if (error) throw new Error('Groww could not be disconnected. Try again.');
}
