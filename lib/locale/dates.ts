// Zone-aware date helpers, so no caller hard-codes Asia/Kolkata or +05:30.
// Pure and client-safe: Intl only. Callers pass zones already validated by lib/locale/person.ts.

import type { PersonLocale } from './person.ts';

export type LocalParts = { year: number; month: number; day: number; hour: number; minute: number; weekday: number };

const partsFormats = new Map<string, Intl.DateTimeFormat>();

function partsFormat(timeZone: string): Intl.DateTimeFormat {
  let format = partsFormats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    partsFormats.set(timeZone, format);
  }
  return format;
}

function toMs(at: Date | string): number {
  return typeof at === 'string' ? new Date(at).getTime() : at.getTime();
}

type WallClock = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function wallClock(ms: number, timeZone: string): WallClock {
  const got: Record<string, number> = {};
  for (const part of partsFormat(timeZone).formatToParts(new Date(ms))) {
    if (part.type !== 'literal') got[part.type] = Number(part.value);
  }
  return { year: got.year, month: got.month, day: got.day, hour: got.hour % 24, minute: got.minute, second: got.second };
}

/** How far the zone's wall clock is ahead of UTC at this instant, in milliseconds. */
function offsetMs(ms: number, timeZone: string): number {
  const w = wallClock(ms, timeZone);
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - Math.floor(ms / 1000) * 1000;
}

const two = (n: number) => String(n).padStart(2, '0');

/** The calendar date (YYYY-MM-DD) on the wall clock in this zone. */
export function localDate(at: Date | string, timeZone: string): string {
  const w = wallClock(toMs(at), timeZone);
  return `${String(w.year).padStart(4, '0')}-${two(w.month)}-${two(w.day)}`;
}

/** Wall-clock parts in this zone. `weekday` is 0 for Monday through 6 for Sunday. */
export function localParts(at: Date | string, timeZone: string): LocalParts {
  const w = wallClock(toMs(at), timeZone);
  const weekday = (new Date(Date.UTC(w.year, w.month - 1, w.day)).getUTCDay() + 6) % 7;
  return { year: w.year, month: w.month, day: w.day, hour: w.hour, minute: w.minute, weekday };
}

function formatOffset(minutes: number): string {
  if (minutes === 0) return 'Z';
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  return `${sign}${two(Math.floor(abs / 60))}:${two(abs % 60)}`;
}

/** The zone's offset from UTC at this instant: `+05:30`, `-07:00`, or `Z` when it is zero. */
export function zoneOffset(at: Date, timeZone: string): string {
  return formatOffset(Math.round(offsetMs(at.getTime(), timeZone) / 60_000));
}

/** Takes a local wall time (`2026-11-12`, `09:30`) and returns an ISO string with the right offset for that day. */
export function zonedIso(date: string, time: string, timeZone: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute, second = 0] = time.split(':').map(Number);
  const wall = Date.UTC(year, month - 1, day, hour, minute, second);
  // First guess from the offset at UTC-noon of that date, then correct once if the offset differs at the guess.
  const first = offsetMs(Date.UTC(year, month - 1, day, 12), timeZone);
  let instant = wall - first;
  const atGuess = offsetMs(instant, timeZone);
  if (atGuess !== first) instant = wall - atGuess;
  const iso = `${date}T${two(hour)}:${two(minute)}:${two(second)}`;
  return `${iso}${zoneOffset(new Date(instant), timeZone)}`;
}

/** The UTC instant (ISO) of local midnight on the 1st of this month. `month` is 1 to 12. */
export function monthStartUtc(year: number, month: number, timeZone: string): string {
  return new Date(zonedIso(`${String(year).padStart(4, '0')}-${two(month)}-01`, '00:00', timeZone)).toISOString();
}

export type WhenPreset = 'day' | 'dayLong' | 'time' | 'shortTime' | 'dayTime' | 'weekdayDayTime' | 'medium' | 'mediumTime' | 'weekday';

const presets: Record<WhenPreset, Intl.DateTimeFormatOptions> = {
  day: { day: 'numeric', month: 'short' },
  dayLong: { weekday: 'long', day: 'numeric', month: 'long' },
  time: { hour: 'numeric', minute: '2-digit', hour12: true },
  // The locale's own short clock: "3:05 pm" in en-IN, "15:05" in en-GB.
  shortTime: { timeStyle: 'short' },
  dayTime: { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true },
  weekdayDayTime: { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' },
  medium: { dateStyle: 'medium' },
  mediumTime: { dateStyle: 'medium', timeStyle: 'short' },
  weekday: { weekday: 'long' },
};

/** A date or time as the person reads it, in their own zone and language. */
export function formatWhen(at: Date | string, loc: PersonLocale, preset: WhenPreset): string {
  return new Intl.DateTimeFormat(loc.locale, { ...presets[preset], timeZone: loc.timeZone }).format(new Date(toMs(at)));
}
