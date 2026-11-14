// What the browser sends the YouTube actions, checked before anything is saved. Pure.

import { MAX_POST_TIMES, type Schedule } from './types';

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
// A region/city name, or UTC: never an offset like "+05:30", which has no daylight-saving rules.
const ZONE_NAME = /^[A-Za-z]+(?:[_/-][A-Za-z0-9+]+)*$/;

let known: ReadonlySet<string> | null = null;

/**
 * A real IANA zone. Intl's own list uses the canonical spelling (Asia/Calcutta
 * where people write Asia/Kolkata), so a name missing from it is still accepted
 * when the runtime can use it as a time zone.
 */
function isTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 64 || !ZONE_NAME.test(value)) return false;
  known ??= new Set(typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : []);
  if (known.has(value)) return true;
  if (!value.includes('/') && value !== 'UTC') return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** The schedule the person asked for, tidied (times and days sorted, each once), or null when any part is not valid. */
export function readSchedule(input: unknown): Omit<Schedule, 'holdUntil'> | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null;
  const raw = input as Record<string, unknown>;
  // postTimes is the list; a lone postTime is what older screens send.
  const asked = Array.isArray(raw.postTimes) ? raw.postTimes : typeof raw.postTime === 'string' ? [raw.postTime] : null;
  if (!asked || asked.length === 0 || asked.length > MAX_POST_TIMES) return null;
  if (!asked.every((time) => typeof time === 'string' && TIME.test(time))) return null;
  const postTimes = [...new Set(asked as string[])].sort();
  if (!Array.isArray(raw.days) || raw.days.length === 0 || raw.days.length > 7) return null;
  if (!raw.days.every((day) => Number.isInteger(day) && day >= 1 && day <= 7)) return null;
  if (!isTimeZone(raw.timezone)) return null;
  if (typeof raw.paused !== 'boolean') return null;
  const days = [...new Set(raw.days as number[])].sort((a, b) => a - b);
  return { postTimes, days, timezone: raw.timezone, paused: raw.paused };
}

/** Which way to move a queue row: -1 earlier, 1 later. */
export function readMove(input: unknown): -1 | 1 | null {
  return input === -1 || input === 1 ? input : null;
}
