import 'server-only';

import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import type { createAdminClient } from '@/lib/supabase/admin';
import { isMissingTable } from '@/lib/supabase/errors';
import { settingsFromRead, zoneForPerson, type PersonSettings } from './person';

const COLUMNS = 'timezone,currency,locale,modules,onboarded_at';

type ReadResult = { data: unknown; error: { code?: string } | null };

function fromRead({ data, error }: ReadResult): PersonSettings {
  if (error && !isMissingTable(error)) console.error('Could not read user_settings', error);
  return settingsFromRead(error ? null : (data as Record<string, unknown> | null), Boolean(error));
}

/** The signed-in person's settings, read through their own session. A missing table or a failed read gives the defaults, marked onboarded. */
export const getPersonSettings = cache(async (userId: string): Promise<PersonSettings> => {
  const supabase = await createClient();
  return fromRead(await supabase.from('user_settings').select(COLUMNS).eq('user_id', userId).maybeSingle());
});

/** The same, for crons running with the service role, which have no session. */
export async function getPersonSettingsAdmin(admin: ReturnType<typeof createAdminClient>, userId: string): Promise<PersonSettings> {
  return fromRead(await admin.from('user_settings').select(COLUMNS).eq('user_id', userId).maybeSingle());
}

type Admin = ReturnType<typeof createAdminClient>;

const ZONE_CHUNK = 100;

/**
 * Each person's saved zone, for crons: one read for many people. A person with
 * no row is absent from the map; null means user_settings couldn't be read.
 */
export async function getPersonZonesAdmin(admin: Admin, userIds: readonly string[]): Promise<Map<string, string> | null> {
  const ids = [...new Set(userIds)];
  const zones = new Map<string, string>();
  // In chunks, so the id list never makes the request URL too long.
  for (let start = 0; start < ids.length; start += ZONE_CHUNK) {
    const { data, error } = await admin.from('user_settings').select('user_id,timezone').in('user_id', ids.slice(start, start + ZONE_CHUNK)); // NOSONAR: a few chunks, one after another
    if (error) {
      if (!isMissingTable(error)) console.error('Could not read user_settings zones', error);
      return null;
    }
    for (const row of data ?? []) zones.set(String(row.user_id), String(row.timezone));
  }
  return zones;
}

/** One person's zone for a cron: their settings row first, the notification zone only when that can't be read (zoneForPerson). */
export async function personZoneAdmin(admin: Admin, userId: string, notificationZone: unknown): Promise<string> {
  const zones = await getPersonZonesAdmin(admin, [userId]);
  return zoneForPerson(zones?.get(userId), notificationZone);
}
