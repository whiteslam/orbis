import 'server-only';

import webpush from 'web-push';
import type { createAdminClient } from '@/lib/supabase/admin';
import { isAllowedPushEndpoint } from '@/lib/notifications/push-endpoint';

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

// Sends to every registered device of the user. Devices the push service reports as gone are removed.
export async function pushToUser(admin: Admin, userId: string, payload: PushPayload) {
  if (!pushConfigured()) return { sent: 0, failed: 0, devices: 0, error: 'Push keys are not configured on the server.' };
  const { data: devices, error } = await admin.from('push_subscriptions').select('endpoint,p256dh,auth').eq('user_id', userId);
  if (error) return { sent: 0, failed: 0, devices: 0, error: 'Registered devices could not be loaded.' };

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
        { TTL: 60 * 60, urgency: 'normal', topic: payload.tag.slice(0, 32), timeout: PUSH_TIMEOUT_MS },
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
  await inBatches(devices ?? [], PUSH_CONCURRENCY, send);
  return { sent, failed, devices: devices?.length ?? 0, error: null as string | null };
}

/** Runs `task` over `items` with at most `limit` in flight at once. */
async function inBatches<T>(items: T[], limit: number, task: (item: T) => Promise<void>) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      await task(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}
