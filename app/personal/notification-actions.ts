'use server';

import { revalidatePath } from 'next/cache';
import { NOTIFICATION_SLOTS, type NotificationPreferences } from '@/lib/notifications/preferences';
import { isAppUnlocked } from '@/lib/security/app-lock';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { deliverSlot } from '@/lib/notifications/deliver';
import { localClock } from '@/lib/notifications/schedule';

const MAX_DEVICES = 10;

async function authenticatedClient() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (error || typeof userId !== 'string' || !(await isAppUnlocked(data?.claims))) return null;
  return { supabase, userId };
}

const setupMessage = 'Apply the profile/journal/notifications migration in Supabase first.';
const isMissing = (code?: string) => ['PGRST205', 'PGRST204', '42P01'].includes(code ?? '');

export async function saveNotificationPreferencesAction(input: NotificationPreferences) {
  const auth = await authenticatedClient();
  if (!auth) return { success: false, message: 'Sign in again to update notifications.' };
  if (!input || typeof input !== 'object' || typeof input.enabled !== 'boolean' || !input.slots || typeof input.timezone !== 'string') return { success: false, message: 'These settings are invalid.' };

  let timezone = 'Asia/Kolkata';
  try {
    timezone = new Intl.DateTimeFormat('en-US', { timeZone: input.timezone }).resolvedOptions().timeZone;
  } catch {
    return { success: false, message: 'Choose a valid time zone.' };
  }

  const row: Record<string, unknown> = { user_id: auth.userId, enabled: input.enabled, timezone };
  for (const slot of NOTIFICATION_SLOTS) {
    const value = input.slots[slot.id];
    if (!value || typeof value.enabled !== 'boolean' || typeof value.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value.time)) {
      return { success: false, message: `Set a valid time for ${slot.label.toLowerCase()}.` };
    }
    row[`${slot.id}_enabled`] = value.enabled;
    row[`${slot.id}_time`] = value.time;
  }

  const { error } = await auth.supabase.from('notification_preferences').upsert(row, { onConflict: 'user_id' });
  if (error) return { success: false, message: isMissing(error.code) ? setupMessage : 'Settings could not be saved. Try again.' };
  revalidatePath('/');
  return { success: true, message: input.enabled ? 'Notification settings saved.' : 'Notifications are off.' };
}

export async function subscribePushAction(input: { endpoint: string; p256dh: string; auth: string; userAgent: string }) {
  const auth = await authenticatedClient();
  if (!auth) return { success: false, message: 'Sign in again to enable notifications.' };
  if (!input || typeof input.endpoint !== 'string' || typeof input.p256dh !== 'string' || typeof input.auth !== 'string') return { success: false, message: 'This device could not be registered.' };

  let endpoint: URL;
  try {
    endpoint = new URL(input.endpoint);
  } catch {
    return { success: false, message: 'This device could not be registered.' };
  }
  if (endpoint.protocol !== 'https:' || input.endpoint.length > 1000 || !/^[A-Za-z0-9_-]{20,200}$/.test(input.p256dh) || !/^[A-Za-z0-9_-]{8,100}$/.test(input.auth)) {
    return { success: false, message: 'This device could not be registered.' };
  }

  const { data: existing, error: countError } = await auth.supabase.from('push_subscriptions').select('endpoint').eq('user_id', auth.userId);
  if (countError) return { success: false, message: isMissing(countError.code) ? setupMessage : 'This device could not be registered.' };
  const known = (existing ?? []).some((row) => row.endpoint === input.endpoint);
  if (!known && (existing ?? []).length >= MAX_DEVICES) return { success: false, message: `You can enable notifications on up to ${MAX_DEVICES} devices. Turn one off first.` };

  // An endpoint belongs to exactly one browser; re-registering replaces its keys.
  await auth.supabase.from('push_subscriptions').delete().eq('user_id', auth.userId).eq('endpoint', input.endpoint);
  const { error } = await auth.supabase.from('push_subscriptions').insert({
    user_id: auth.userId,
    endpoint: input.endpoint,
    p256dh: input.p256dh,
    auth: input.auth,
    user_agent: typeof input.userAgent === 'string' ? input.userAgent.slice(0, 300) : null,
  });
  if (error) return { success: false, message: error.code === '23505' ? 'This device is registered to another Orbis account.' : 'This device could not be registered.' };
  revalidatePath('/');
  return { success: true, message: 'Notifications enabled on this device.' };
}

const TEST_LIMIT_PER_DAY = 5;

// Sends a real notification now, written for the part of the day it is, so the user can check their phone.
export async function sendTestNotificationAction() {
  const auth = await authenticatedClient();
  if (!auth) return { success: false, message: 'Sign in again to send a test.' };

  const admin = createAdminClient();
  const { data: prefs } = await admin.from('notification_preferences').select('timezone').eq('user_id', auth.userId).maybeSingle();
  const timeZone = prefs?.timezone || 'Asia/Kolkata';
  const now = new Date();
  const clock = localClock(now, timeZone);

  const since = new Date(now.getTime() - 24 * 60 * 60_000).toISOString();
  const { count } = await admin.from('notification_log').select('id', { count: 'exact', head: true }).eq('user_id', auth.userId).eq('slot', 'test').gte('created_at', since);
  if ((count ?? 0) >= TEST_LIMIT_PER_DAY) return { success: false, message: `You can send ${TEST_LIMIT_PER_DAY} test notifications a day. Try again tomorrow.` };

  const hour = clock.minutes / 60;
  const messageSlot = hour < 11 ? 'morning' : hour < 17 ? 'lunch' : hour < 21 ? 'evening' : 'night';
  const result = await deliverSlot(admin, { userId: auth.userId, slot: 'test', messageSlot, localDate: clock.date, timeZone, now });
  if (result.status === 'failed') return { success: false, message: result.reason };
  if (result.status !== 'sent') return { success: false, message: 'Orbis had nothing to send right now. Try again later.' };
  if (result.devices === 0) return { success: false, message: 'No device is registered. Tap Enable on your phone first.' };
  if (result.sent === 0) return { success: false, message: 'The push service rejected this device. Turn notifications off and on again here.' };
  return { success: true, message: `Sent “${result.title}” to ${result.sent} device${result.sent === 1 ? '' : 's'}.` };
}

export async function unsubscribePushAction(endpoint: string) {
  const auth = await authenticatedClient();
  if (!auth) return { success: false, message: 'Sign in again to update notifications.' };
  if (typeof endpoint !== 'string' || endpoint.length > 1000) return { success: false, message: 'This device is invalid.' };
  const { error } = await auth.supabase.from('push_subscriptions').delete().eq('user_id', auth.userId).eq('endpoint', endpoint);
  if (error) return { success: false, message: 'This device could not be turned off.' };
  revalidatePath('/');
  return { success: true, message: 'Notifications turned off on this device.' };
}
