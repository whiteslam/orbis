import 'server-only';

import webpush from 'web-push';
import type { createAdminClient } from '@/lib/supabase/admin';

type Admin = ReturnType<typeof createAdminClient>;

export type PushPayload = { title: string; body: string; tag: string; url: string };

let configured = false;

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
  await Promise.all((devices ?? []).map(async (device) => {
    try {
      await webpush.sendNotification(
        { endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } },
        JSON.stringify(payload),
        { TTL: 60 * 60, urgency: 'normal', topic: payload.tag.slice(0, 32) },
      );
      sent += 1;
    } catch (pushError) {
      failed += 1;
      const status = (pushError as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await admin.from('push_subscriptions').delete().eq('user_id', userId).eq('endpoint', device.endpoint);
      }
    }
  }));
  return { sent, failed, devices: devices?.length ?? 0, error: null as string | null };
}
