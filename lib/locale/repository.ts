import 'server-only';

import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import type { createAdminClient } from '@/lib/supabase/admin';
import { isMissingTable } from '@/lib/supabase/errors';
import { normalizeSettings, type PersonSettings } from './person';

const COLUMNS = 'timezone,currency,locale,modules,onboarded_at';

/** The signed-in person's settings, read through their own session. A missing table or row gives the defaults. */
export const getPersonSettings = cache(async (userId: string): Promise<PersonSettings> => {
  const supabase = await createClient();
  const { data, error } = await supabase.from('user_settings').select(COLUMNS).eq('user_id', userId).maybeSingle();
  if (error && !isMissingTable(error)) return normalizeSettings(null);
  return normalizeSettings(error ? null : (data as Record<string, unknown> | null));
});

/** The same, for crons running with the service role, which have no session. */
export async function getPersonSettingsAdmin(admin: ReturnType<typeof createAdminClient>, userId: string): Promise<PersonSettings> {
  const { data, error } = await admin.from('user_settings').select(COLUMNS).eq('user_id', userId).maybeSingle();
  return normalizeSettings(error ? null : (data as Record<string, unknown> | null));
}
