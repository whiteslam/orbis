import 'server-only';

import { DEFAULT_PREFERENCES, NOTIFICATION_SLOTS, type NotificationPreferences, type NotificationSettings } from '@/lib/notifications/preferences';
import { createClient } from '@/lib/supabase/server';
import { isMissingTable } from '@/lib/supabase/errors';
import { getPersonSettings } from '@/lib/locale/repository';
import { ONBOARDED_UNKNOWN, zoneForPerson } from '@/lib/locale/person';

type PreferenceRow = Record<string, unknown>;

/** The person's own zone (null when their settings couldn't be read) wins over the copy saved here (zoneForPerson). */
export function preferencesFromRow(row: PreferenceRow | null, personZone: string | null): NotificationPreferences {
  if (!row) return { ...DEFAULT_PREFERENCES, timezone: zoneForPerson(personZone, null) };
  const slots = { ...DEFAULT_PREFERENCES.slots };
  for (const slot of NOTIFICATION_SLOTS) {
    const time = row[`${slot.id}_time`];
    slots[slot.id] = {
      enabled: row[`${slot.id}_enabled`] !== false,
      time: typeof time === 'string' ? time.slice(0, 5) : slot.defaultTime,
    };
  }
  return { enabled: row.enabled === true, timezone: zoneForPerson(personZone, row.timezone), slots };
}

export async function getNotificationSettings(userId: string): Promise<NotificationSettings> {
  const supabase = await createClient();
  const pushConfigured = Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim());
  const [preferences, devices, person] = await Promise.all([
    supabase.from('notification_preferences').select('*').eq('user_id', userId).maybeSingle(),
    supabase.from('push_subscriptions').select('endpoint').eq('user_id', userId).limit(10),
    getPersonSettings(userId),
  ]);
  const personZone = person.onboardedAt === ONBOARDED_UNKNOWN ? null : person.timeZone;
  const error = preferences.error ?? devices.error;
  if (error) {
    const missing = isMissingTable(error);
    return { state: missing ? 'setup' : 'unavailable', preferences: { ...DEFAULT_PREFERENCES, timezone: person.timeZone }, deviceEndpoints: [], pushConfigured };
  }
  return {
    state: 'ready',
    preferences: preferencesFromRow(preferences.data, personZone),
    deviceEndpoints: (devices.data ?? []).map((row) => row.endpoint),
    pushConfigured,
  };
}
