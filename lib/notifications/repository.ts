import 'server-only';

import { DEFAULT_PREFERENCES, NOTIFICATION_SLOTS, type NotificationPreferences, type NotificationSettings } from '@/lib/notifications/preferences';
import { createClient } from '@/lib/supabase/server';
import { isMissingTable } from '@/lib/supabase/errors';
import { getPersonSettings } from '@/lib/locale/repository';

type PreferenceRow = Record<string, unknown>;

/** A saved timezone wins; without one, the person's own zone from their settings. */
export function preferencesFromRow(row: PreferenceRow | null, personZone: string): NotificationPreferences {
  if (!row) return { ...DEFAULT_PREFERENCES, timezone: personZone };
  const slots = { ...DEFAULT_PREFERENCES.slots };
  for (const slot of NOTIFICATION_SLOTS) {
    const time = row[`${slot.id}_time`];
    slots[slot.id] = {
      enabled: row[`${slot.id}_enabled`] !== false,
      time: typeof time === 'string' ? time.slice(0, 5) : slot.defaultTime,
    };
  }
  return { enabled: row.enabled === true, timezone: typeof row.timezone === 'string' ? row.timezone : personZone, slots };
}

export async function getNotificationSettings(userId: string): Promise<NotificationSettings> {
  const supabase = await createClient();
  const pushConfigured = Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim());
  const [preferences, devices, { timeZone }] = await Promise.all([
    supabase.from('notification_preferences').select('*').eq('user_id', userId).maybeSingle(),
    supabase.from('push_subscriptions').select('endpoint').eq('user_id', userId).limit(10),
    getPersonSettings(userId),
  ]);
  const error = preferences.error ?? devices.error;
  if (error) {
    const missing = isMissingTable(error);
    return { state: missing ? 'setup' : 'unavailable', preferences: { ...DEFAULT_PREFERENCES, timezone: timeZone }, deviceEndpoints: [], pushConfigured };
  }
  return {
    state: 'ready',
    preferences: preferencesFromRow(preferences.data, timeZone),
    deviceEndpoints: (devices.data ?? []).map((row) => row.endpoint),
    pushConfigured,
  };
}
