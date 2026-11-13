import 'server-only';

import webpush from 'web-push';
import { pushTopic } from '@/lib/notifications/topic';
import type { createAdminClient } from '@/lib/supabase/admin';
import { isAllowedPushEndpoint } from '@/lib/notifications/push-endpoint';
import { fcmConfigured, sendFcm } from '@/lib/notifications/fcm';

type Admin = ReturnType<typeof createAdminClient>;

export type PushPayload = { title: string; body: string; tag: string; url: string };

let configured = false;

// A push service that hangs must not hold the scheduler; a user with many
// devices must not open dozens of sockets at once.
const PUSH_TIMEOUT_MS = 5_000;
const PUSH_CONCURRENCY = 4;

// VAPID keys identify Orbis to the browser push services. The subject is a contact URL or mailto: address.
export function pushConfigured() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) return false;
  if (!configured) {
    // web-push only accepts https: or mailto: subjects, so a local http://localhost site URL is not usable.
    const site = process.env.NEXT_PUBLIC_SITE_URL?.trim();
    const subject = process.env.VAPID_SUBJECT?.trim() || (site?.startsWith('https://') ? site : 'https://orbis-starter.vercel.app');
    try {
      webpush.setVapidDetails(subject, publicKey, privateKey);
    } catch {
      return false;
    }
    configured = true;
  }
  return true;
}

// Sends to every registered device of the user: browsers through web push, and
// Android phones that hold an FCM token through FCM. Either channel is optional;
// a channel that is not set up is skipped. Devices a push service reports as gone
// are removed (a phone only loses its token, so it stays registered).
export async function pushToUser(admin: Admin, userId: string, payload: PushPayload) {
  const web = pushConfigured();
  const fcm = fcmConfigured();
  if (!web && !fcm) return { sent: 0, failed: 0, devices: 0, error: 'Push keys are not configured on the server.' };

  let subscriptions: { endpoint: string; p256dh: string; auth: string }[] = [];
  if (web) {
    const { data, error } = await admin.from('push_subscriptions').select('endpoint,p256dh,auth').eq('user_id', userId);
    if (error) return { sent: 0, failed: 0, devices: 0, error: 'Registered devices could not be loaded.' };
    subscriptions = data ?? [];
  }
  let phones: { id: string; push_token: string }[] = [];
  if (fcm) {
    const { data, error } = await admin.from('devices').select('id,push_token').eq('user_id', userId).not('push_token', 'is', null).is('revoked_at', null);
    // With web push working, a phone list that fails to load only costs the phones this time.
    if (error && !web) return { sent: 0, failed: 0, devices: 0, error: 'Registered phones could not be loaded.' };
    phones = (data ?? []) as { id: string; push_token: string }[];
  }

  let sent = 0;
  let failed = 0;
  const send = async (device: { endpoint: string; p256dh: string; auth: string }) => {
    // Rows written before the endpoint CHECK existed are never contacted if they
    // point anywhere but a real push service.
    if (!isAllowedPushEndpoint(device.endpoint)) {
      failed += 1;
      return;
    }
    try {
      await webpush.sendNotification(
        { endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } },
        JSON.stringify(payload),
        { TTL: 60 * 60, urgency: 'normal', topic: pushTopic(payload.tag), timeout: PUSH_TIMEOUT_MS },
      );
      sent += 1;
    } catch (pushError) {
      failed += 1;
      const status = (pushError as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await admin.from('push_subscriptions').delete().eq('user_id', userId).eq('endpoint', device.endpoint);
      }
    }
  };
  const sendToPhone = async (phone: { id: string; push_token: string }) => {
    const outcome = await sendFcm(phone.push_token, payload);
    if (outcome === 'sent') {
      sent += 1;
      return;
    }
    failed += 1;
    // Only if the phone still holds this very token: it may have rotated it meanwhile.
    if (outcome === 'gone') await admin.from('devices').update({ push_token: null }).eq('id', phone.id).eq('user_id', userId).eq('push_token', phone.push_token);
  };
  await inBatches(subscriptions, PUSH_CONCURRENCY, send);
  await inBatches(phones, PUSH_CONCURRENCY, sendToPhone);
  return { sent, failed, devices: subscriptions.length + phones.length, error: null as string | null };
}

/** Runs `task` over `items` with at most `limit` in flight at once. */
async function inBatches<T>(items: T[], limit: number, task: (item: T) => Promise<void>) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      await task(item); // NOSONAR: each worker runs its share one at a time; that is what caps how many are in flight
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}
