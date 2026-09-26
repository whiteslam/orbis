import 'server-only';

import type { createAdminClient } from '@/lib/supabase/admin';
import { buildNotificationContext } from '@/lib/notifications/context';
import { composeNotification } from '@/lib/notifications/compose';
import { pushToUser } from '@/lib/notifications/push';
import type { Slot } from '@/lib/notifications/schedule';

type Admin = ReturnType<typeof createAdminClient>;

export type DeliveryResult =
  | { status: 'sent'; title: string; body: string; devices: number; sent: number }
  | { status: 'skipped' | 'duplicate' }
  | { status: 'failed'; reason: string };

// Claims the (user, slot, date) row first so a slot is delivered at most once, then writes and pushes it.
// A test send uses slot 'test' (no uniqueness) but writes the message for `messageSlot`.
export async function deliverSlot(admin: Admin, input: { userId: string; slot: Slot | 'test'; messageSlot: Slot; localDate: string; timeZone: string; now: Date }): Promise<DeliveryResult> {
  const { data: claim, error: claimError } = await admin
    .from('notification_log')
    .insert({ user_id: input.userId, slot: input.slot, local_date: input.localDate, status: 'pending' })
    .select('id')
    .single();
  if (claimError) {
    if (claimError.code === '23505') return { status: 'duplicate' };
    return { status: 'failed', reason: ['PGRST205', '42P01'].includes(claimError.code ?? '') ? 'The notification log migration (019) is not applied.' : 'The notification could not be recorded.' };
  }

  try {
    const context = await buildNotificationContext(admin, input.userId, input.messageSlot, input.now, input.timeZone);
    const message = await composeNotification(input.userId, context);
    if ('skip' in message) {
      await admin.from('notification_log').update({ status: 'skipped' }).eq('id', claim.id);
      return { status: 'skipped' };
    }
    const push = await pushToUser(admin, input.userId, { title: message.title, body: message.body, tag: `orbis-${input.messageSlot}`, url: '/?notifications=open' });
    await admin.from('notification_log').update({
      status: push.sent > 0 || push.devices === 0 ? 'sent' : 'failed',
      title: message.title,
      body: message.body,
      source: message.source,
      devices_sent: push.sent,
    }).eq('id', claim.id);
    if (push.error) return { status: 'failed', reason: push.error };
    return { status: 'sent', title: message.title, body: message.body, devices: push.devices, sent: push.sent };
  } catch {
    await admin.from('notification_log').update({ status: 'failed' }).eq('id', claim.id);
    return { status: 'failed', reason: 'The notification could not be prepared.' };
  }
}
