export const PUSHES_PER_DAY = 2;
const QUIET_UNTIL = 7 * 60;
const QUIET_FROM = 22 * 60;
const FRESH_MS = 24 * 60 * 60_000;

/** Whether one heads-up may go out as a push right now. Pure; the scan route supplies the facts. */
export function mayPush(
  headsup: { urgency: 'normal' | 'urgent'; createdAt: string; pushedAt: string | null; snoozedUntil: string | null; status: string },
  context: { pushesToday: number; localMinutes: number; notificationsEnabled: boolean; hasDevice: boolean },
  now: Date,
) {
  if (headsup.urgency !== 'urgent' || headsup.status !== 'new' || headsup.pushedAt) return false;
  if (headsup.snoozedUntil && new Date(headsup.snoozedUntil) > now) return false;
  if (now.getTime() - new Date(headsup.createdAt).getTime() > FRESH_MS) return false;
  if (!context.notificationsEnabled || !context.hasDevice) return false;
  if (context.pushesToday >= PUSHES_PER_DAY) return false;
  return context.localMinutes >= QUIET_UNTIL && context.localMinutes < QUIET_FROM;
}
