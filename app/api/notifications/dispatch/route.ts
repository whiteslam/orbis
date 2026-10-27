import { cronAuthorized } from '@/lib/cron/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { deliverSlot } from '@/lib/notifications/deliver';
import { dueSlots, SLOT_IDS, type SlotPreferences } from '@/lib/notifications/schedule';

export const maxDuration = 60;

const TIME_BUDGET_MS = 50_000;

// Called every 15 minutes by the Supabase scheduler (pg_cron + pg_net). Sends each user's due slots once.
export async function POST(request: Request) {
  if (!cronAuthorized(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const startedAt = Date.now();
  const now = new Date();
  const admin = createAdminClient();
  const { data: rows, error } = await admin.from('notification_preferences').select('*').eq('enabled', true);
  if (error) return Response.json({ error: 'Preferences could not be loaded.' }, { status: 500 });

  const counts = { users: rows?.length ?? 0, sent: 0, skipped: 0, duplicate: 0, failed: 0, deferred: 0 };
  for (const row of rows ?? []) {
    const prefs: SlotPreferences = {
      enabled: row.enabled,
      timezone: row.timezone,
      slots: Object.fromEntries(SLOT_IDS.map((slot) => [slot, { enabled: row[`${slot}_enabled`], time: String(row[`${slot}_time`] ?? '') }])) as SlotPreferences['slots'],
    };
    const due = dueSlots(prefs, now);
    for (const slot of due.slots) {
      // Leave work for the next run (within the 45-minute window) rather than exceed the function time limit.
      if (Date.now() - startedAt > TIME_BUDGET_MS) {
        counts.deferred += 1;
        continue;
      }
      const result = await deliverSlot(admin, { userId: row.user_id, slot, messageSlot: slot, localDate: due.date, timeZone: prefs.timezone, now }); // NOSONAR: sent one at a time so the time budget above can defer the rest
      counts[result.status] += 1;
    }
  }
  return Response.json(counts);
}
