// When the next video is due: the person’s post times and days on their own wall clock, once per
// time at most, and never before the quota hold. Pure and client-safe. Relative imports only,
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

/** The day's post times in minutes since midnight, earliest first, each once. */
export function slotMinutes(schedule: Pick<Schedule, 'postTimes'>): number[] {
  return [...new Set(schedule.postTimes.map(postMinutes))].sort((a, b) => a - b);
}

const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** The calendar date `days` after this YYYY-MM-DD one, with its ISO weekday. */
function addDays(date: string, days: number): { date: string; isoDay: number } {
  const [year, month, day] = date.split('-').map(Number);
  const moved = new Date(Date.UTC(year, month - 1, day + days));
  return { date: moved.toISOString().slice(0, 10), isoDay: moved.getUTCDay() === 0 ? 7 : moved.getUTCDay() };
}

/** Local midnight at the start of today in this zone: scheduled posts from here on count as today's. */
export function dayStart(now: Date, timeZone: string): Date {
  return new Date(zonedIso(localDay(now, timeZone).date, '00:00', timeZone));
}

/**
 * Whether the schedule should post now: not paused, not on hold, today is a listed day, and more
 * of today's post times have come than the schedule has already posted today. So each time posts
 * once, a missed time is caught up once, and a day never gets more posts than it has times. A
 * manual post does not count, so the caller passes only how many scheduled posts went out today.
 */
export function isDue(schedule: Schedule, now: Date, postedToday: number): boolean {
  if (schedule.paused) return false;
  if (schedule.holdUntil && now.getTime() < new Date(schedule.holdUntil).getTime()) return false;
  const today = localDay(now, schedule.timezone);
  if (!schedule.days.includes(today.isoDay)) return false;
  const passed = slotMinutes(schedule).filter((minutes) => minutes <= today.minutes).length;
  return passed > postedToday;
}

/**
 * The next time the schedule posts, as an instant, or null when it is paused or has no days.
 * Today's times are used in order, one per scheduled post already made today: an unused time
 * that has passed is returned as it is (it is then due now). A quota hold pushes it to the first
 * time after the hold.
 */
export function nextSlot(schedule: Schedule, now: Date, postedToday: number): Date | null {
  if (schedule.paused || schedule.days.length === 0) return null;
  const times = slotMinutes(schedule);
  if (!times.length) return null;
  const today = localDay(now, schedule.timezone).date;
  const hold = schedule.holdUntil ? new Date(schedule.holdUntil).getTime() : Number.NEGATIVE_INFINITY;
  // A listed day comes round within a week; the extra days cover a hold that runs into the week after.
  for (let ahead = 0; ahead <= 14; ahead++) {
    const day = addDays(today, ahead);
    if (!schedule.days.includes(day.isoDay)) continue;
    for (const [index, minutes] of times.entries()) {
      if (ahead === 0 && index < postedToday) continue;
      const slot = new Date(zonedIso(day.date, hhmm(minutes), schedule.timezone));
      if (slot.getTime() < hold) continue;
      return slot;
    }
  }
  return null;
}

/** Local midnight at the start of the next day in this zone: where the quota hold ends. */
export function nextDayStart(now: Date, timeZone: string): Date {
  const next = addDays(localDay(now, timeZone).date, 1).date;
  return new Date(zonedIso(next, '00:00', timeZone));
}
