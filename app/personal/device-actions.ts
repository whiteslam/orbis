'use server';

// Settings → Phone access: the person's phones, and what Orbis kept from each
// source on the server. The cookie client only, so row-level security scopes every
// read and write to the signed-in person; the same signed-in and unlocked checks
// as app/personal/actions.ts.

import { createClient } from '@/lib/supabase/server';
import { isAppUnlocked } from '@/lib/security/app-lock';
import { phoneTablesMissing } from '@/lib/device/not-set-up';
import { SOURCES, type Source } from '@/lib/device/sources';

/** A phone that is still signed in. Removed phones are left out (see listDevices). */
export type DeviceRow = {
  id: string;
  name: string;
  flavour: 'play' | 'direct';
  lastSeenAt: string | null;
  createdAt: string;
  revokedAt: string | null;
  /** The sources switched on for this phone, as of its last sync. */
  sources: Source[];
};

type Result = { success: boolean; message: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Ten phones at most can be active; this only bounds the read.
const MAX_LISTED = 20;

async function authenticatedClient() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (error || typeof userId !== 'string' || !(await isAppUnlocked(data?.claims))) return null;
  return { supabase, userId };
}

/**
 * The person's phones that are still signed in, newest first, each with the sources
 * it has on. A removed phone is hidden: removing is one way, and it no longer counts
 * toward the ten. Rejects when the person isn't signed in and unlocked, or the read fails.
 * Before the phone tables exist (their migration not applied yet) there are no phones.
 */
export async function listDevices(): Promise<DeviceRow[]> {
  const auth = await authenticatedClient();
  if (!auth) throw new Error('Sign in again to see your phones.');
  // Named columns: secret_hash and push_token aren't granted, so select('*') is refused.
  const { data: devices, error } = await auth.supabase
    .from('devices')
    .select('id, name, flavour, last_seen_at, created_at, revoked_at')
    .eq('user_id', auth.userId)
    .is('revoked_at', null)
    .order('created_at', { ascending: false })
    .limit(MAX_LISTED);
  if (error && phoneTablesMissing(error)) return [];
  if (error) throw new Error('Your phones could not be loaded.');
  const rows = (devices ?? []) as Array<{ id: string; name: string; flavour: 'play' | 'direct'; last_seen_at: string | null; created_at: string; revoked_at: string | null }>;
  if (!rows.length) return [];

  const { data: switches, error: sourcesError } = await auth.supabase
    .from('device_sources')
    .select('device_id, source')
    .eq('user_id', auth.userId)
    .eq('enabled', true)
    .in('device_id', rows.map((row) => row.id));
  if (sourcesError && !phoneTablesMissing(sourcesError)) throw new Error('Your phones could not be loaded.');
  const on = new Map<string, Source[]>();
  for (const { device_id: deviceId, source } of (sourcesError ? [] : switches ?? []) as Array<{ device_id: string; source: Source }>) {
    on.set(deviceId, [...(on.get(deviceId) ?? []), source]);
  }

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    flavour: row.flavour,
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
    // In the order the sources are listed everywhere else.
    sources: SOURCES.filter((source) => on.get(row.id)?.includes(source)),
  }));
}

/**
 * Removes a phone from the account. One way: a database trigger refuses any change
 * once revoked_at is set, so only a phone still active is touched. The phone finds
 * out on its next sync and signs itself out.
 */
export async function revokeDevice(deviceId: string): Promise<Result> {
  const auth = await authenticatedClient();
  if (!auth) return { success: false, message: 'Sign in again to remove this phone.' };
  if (typeof deviceId !== 'string' || !UUID.test(deviceId)) return { success: false, message: 'This phone is invalid.' };
  const { error } = await auth.supabase
    .from('devices')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', deviceId.toLowerCase())
    .eq('user_id', auth.userId)
    .is('revoked_at', null);
  if (error) return { success: false, message: 'The phone could not be removed. Try again in a little while.' };
  return { success: true, message: 'Phone removed. It signs out the next time it syncs.' };
}

/**
 * Deletes what Orbis kept on the server from one source: its signals and its
 * activity counts, on every phone. It does not switch the source off on any phone;
 * only the phone can do that, and until it does, its next sync can add more.
 * A table that isn't set up yet holds nothing, so there is nothing to delete from it.
 */
export async function deleteSourceData(source: Source): Promise<Result> {
  const auth = await authenticatedClient();
  if (!auth) return { success: false, message: 'Sign in again to delete this.' };
  if (!(SOURCES as readonly unknown[]).includes(source)) return { success: false, message: 'That source is invalid.' };
  const signals = await auth.supabase.from('signals').delete().eq('user_id', auth.userId).eq('source', source);
  if (signals.error && !phoneTablesMissing(signals.error)) return { success: false, message: 'It could not be deleted. Try again in a little while.' };
  const ledger = await auth.supabase.from('activity_ledger').delete().eq('user_id', auth.userId).eq('source', source);
  if (ledger.error && !phoneTablesMissing(ledger.error)) return { success: false, message: 'It could not all be deleted. Try again in a little while.' };
  return { success: true, message: 'Deleted what Orbis kept on the server from this source.' };
}
