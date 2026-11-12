import 'server-only';

import type { SignedInSession } from '@/lib/auth/session';
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

  const { error } = await supabase.from('user_settings').upsert(row, { onConflict: 'user_id' });
  if (error) {
    console.error('Saving user_settings failed', error);
    return false;
  }

  const { error: zoneError } = await supabase.from('notification_preferences').update({ timezone: input.timeZone }).eq('user_id', userId);
  if (zoneError && !isMissingTable(zoneError)) console.error('Keeping the notification time zone in step failed', zoneError);
  return true;
}
