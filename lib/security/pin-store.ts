import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { hashPin, MAX_PIN_ATTEMPTS, verifyPin } from '@/lib/security/pin';

// none: no PIN yet · active: PIN can unlock · locked: too many wrong tries · unavailable: migration not applied / DB error.
export type PinStatus = 'none' | 'active' | 'locked' | 'unavailable';

export type PinCheck =
  | { outcome: 'ok' }
  | { outcome: 'wrong'; remaining: number }
  | { outcome: 'locked' }
  | { outcome: 'unavailable' };

export async function getPinStatus(userId: string): Promise<PinStatus> {
  const { data, error } = await createAdminClient().from('user_app_pins').select('failed_attempts').eq('user_id', userId).maybeSingle();
  if (error) return 'unavailable';
  if (!data) return 'none';
  return data.failed_attempts >= MAX_PIN_ATTEMPTS ? 'locked' : 'active';
}

// Saving a PIN always starts a fresh attempt counter.
export async function savePin(userId: string, pin: string) {
  const { error } = await createAdminClient().from('user_app_pins').upsert(
    { user_id: userId, pin_hash: hashPin(pin), failed_attempts: 0, updated_at: new Date().toISOString() },
    { onConflict: 'user_id' },
  );
  return !error;
}

export async function checkPin(userId: string, pin: string): Promise<PinCheck> {
  const admin = createAdminClient();
  // The attempt is reserved before the hash is compared, so the limit holds even for parallel guesses.
  const { data, error } = await admin.rpc('consume_app_pin_attempt', { p_user_id: userId });
  if (error) return { outcome: 'unavailable' };
  const row = (Array.isArray(data) ? data[0] : data) as { pin_hash?: string; failed_attempts?: number } | undefined;
  if (!row?.pin_hash) return { outcome: 'locked' };

  if (verifyPin(pin, row.pin_hash)) {
    const { error: resetError } = await admin.from('user_app_pins').update({ failed_attempts: 0, updated_at: new Date().toISOString() }).eq('user_id', userId);
    return resetError ? { outcome: 'unavailable' } : { outcome: 'ok' };
  }

  const remaining = MAX_PIN_ATTEMPTS - Number(row.failed_attempts ?? MAX_PIN_ATTEMPTS);
  return remaining > 0 ? { outcome: 'wrong', remaining } : { outcome: 'locked' };
}
