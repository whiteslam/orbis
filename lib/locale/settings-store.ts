import 'server-only';

import type { SignedInSession } from '@/lib/auth/session';
import { canonicalTimeZone } from '@/lib/locale/person';
import type { SettingsInput } from '@/lib/locale/settings-input';
import { isMissingTable } from '@/lib/supabase/errors';

/**
 * Writes a person's settings row. `onboarded` also stamps onboarded_at, which
 * is what ends onboarding. A locale left undefined is not written, so a new row
 * gets the default and an existing one keeps its own.
 *
 * Heads-ups, the career watch and notifications read the zone kept in
 * notification_preferences first, so when that row exists its zone is moved
 * in step. That second write is best effort: the settings row is the record.
 */
export async function writePersonSettings(supabase: SignedInSession['supabase'], userId: string, input: SettingsInput, { onboarded = false } = {}): Promise<boolean> {
  const row: Record<string, unknown> = { user_id: userId, timezone: input.timeZone, currency: input.currency, modules: input.modules };
  if (input.locale !== undefined) row.locale = input.locale;
  if (onboarded) row.onboarded_at = new Date().toISOString();

  if (!(await upsertSettings(supabase, row))) return false;

  const { error: zoneError } = await supabase.from('notification_preferences').update({ timezone: input.timeZone }).eq('user_id', userId);
  if (zoneError && !isMissingTable(zoneError)) console.error('Keeping the notification time zone in step failed', zoneError);
  return true;
}

/**
 * The other direction: Notifications saved a zone, so the settings row takes it
 * too, by its current IANA name. Only the zone is written; a missing row is
 * created with the column defaults for everything else (onboarded_at, modules
 * and currency are left alone).
 */
export async function writePersonTimeZone(supabase: SignedInSession['supabase'], userId: string, timeZone: string): Promise<boolean> {
  return upsertSettings(supabase, { user_id: userId, timezone: canonicalTimeZone(timeZone) });
}

async function upsertSettings(supabase: SignedInSession['supabase'], row: Record<string, unknown>): Promise<boolean> {
  const { error } = await supabase.from('user_settings').upsert(row, { onConflict: 'user_id' });
  if (!error) return true;
  if (!isMissingTable(error)) console.error('Saving user_settings failed', error);
  return false;
}
