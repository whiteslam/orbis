// When the next video is due: the person’s post time and days on their own wall clock, once a
// day at most, and never before the quota hold. Pure and client-safe. Relative imports only,
// because the home-PC import script loads this with plain Node.

import { localDate, localParts, zonedIso } from '../locale/dates.ts';
import type { Schedule } from './types';

export type LocalDay = { date: string; isoDay: number; minutes: number };

/** The calendar day in this zone: its date, its ISO weekday (Monday 1, Sunday 7) and minutes since midnight. */
export function localDay(at: Date, timeZone: string): LocalDay {
  const parts = localParts(at, timeZone);
  return { date: localDate(at, timeZone), isoDay: parts.weekday + 1, minutes: parts.hour * 60 + parts.minute };
}

function postMinutes(postTime: string): number {
  const [hour, minute] = postTime.split(':').map(Number);
  return (Number.isFinite(hour) ? hour : 0) * 60 + (Number.isFinite(minute) ? minute : 0);
}

/** The calendar date `days` after this YYYY-MM-DD one, with its ISO weekday. */
function addDays(date: string, days: number): { date: string; isoDay: number } {
  const [year, month, day] = date.split('-').map(Number);
  const moved = new Date(Date.UTC(year, month - 1, day + days));
  return { date: moved.toISOString().slice(0, 10), isoDay: moved.getUTCDay() === 0 ? 7 : moved.getUTCDay() };
}

/**
 * Whether the schedule should post now: not paused, not on hold, today is a listed day, the post
 * time has come, and the schedule has not already posted on this local day. A manual post does not
 * count, so the caller passes only when a scheduled post last went out.
 */
export function isDue(schedule: Schedule, now: Date, lastScheduledAt: string | null): boolean {
  if (schedule.paused) return false;
  if (schedule.holdUntil && now.getTime() < new Date(schedule.holdUntil).getTime()) return false;
  const today = localDay(now, schedule.timezone);
  if (!schedule.days.includes(today.isoDay)) return false;
  if (today.minutes < postMinutes(schedule.postTime)) return false;
  if (lastScheduledAt) {
    const last = new Date(lastScheduledAt);
    if (!Number.isNaN(last.getTime()) && localDate(last, schedule.timezone) === today.date) return false;
  }
  return true;
}

/**
 * The next time the schedule posts, as an instant, or null when it is paused or has no days.
 * Today counts when it is a listed day and nothing has been posted yet, even if the time has
 * passed (it is then due now). A quota hold pushes it to the first slot after the hold.
 */
export function nextSlot(schedule: Schedule, now: Date, postedToday: boolean): Date | null {
  if (schedule.paused || schedule.days.length === 0) return null;
  const today = localDay(now, schedule.timezone).date;
  const hold = schedule.holdUntil ? new Date(schedule.holdUntil).getTime() : Number.NEGATIVE_INFINITY;
  const [hour, minute] = [Math.floor(postMinutes(schedule.postTime) / 60), postMinutes(schedule.postTime) % 60];
  const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  // A listed day comes round within a week; the extra days cover a hold that runs into the week after.
  for (let ahead = 0; ahead <= 14; ahead++) {
    if (ahead === 0 && postedToday) continue;
    const day = addDays(today, ahead);
    if (!schedule.days.includes(day.isoDay)) continue;
    const slot = new Date(zonedIso(day.date, time, schedule.timezone));
    if (slot.getTime() < hold) continue;
    return slot;
  }
  return null;
}

/** Local midnight at the start of the next day in this zone: where the quota hold ends. */
export function nextDayStart(now: Date, timeZone: string): Date {
  const next = addDays(localDay(now, timeZone).date, 1).date;
  return new Date(zonedIso(next, '00:00', timeZone));
}
