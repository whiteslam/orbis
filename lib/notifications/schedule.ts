// Pure scheduling rules for daily notifications (no Next.js imports, unit tested with node:test).

export const SLOT_IDS = ['morning', 'lunch', 'evening', 'night'] as const;
export type Slot = (typeof SLOT_IDS)[number];

// A slot is sent from its time until this many minutes later; after that it is skipped for the day.
export const CATCH_UP_MINUTES = 45;

export type SlotPreferences = {
  enabled: boolean;
  timezone: string;
  slots: Record<Slot, { enabled: boolean; time: string }>;
};

// The wall-clock date and minute-of-day in a timezone, e.g. { date: '2026-09-24', minutes: 845 } for 14:05.
export function localClock(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '00';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

export function timeToMinutes(value: string) {
  const match = /^(\d{2}):(\d{2})/.exec(value);
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return minutes >= 0 && minutes < 24 * 60 ? minutes : null;
}

// Slots whose time has arrived within the catch-up window, for the user's current local date.
export function dueSlots(prefs: SlotPreferences, now: Date): { date: string; slots: Slot[] } {
  let clock: { date: string; minutes: number };
  try {
    clock = localClock(now, prefs.timezone);
  } catch {
    clock = localClock(now, 'Asia/Kolkata');
  }
  if (!prefs.enabled) return { date: clock.date, slots: [] };
  const slots = SLOT_IDS.filter((slot) => {
    const setting = prefs.slots[slot];
    const start = setting?.enabled ? timeToMinutes(setting.time) : null;
    return start !== null && clock.minutes >= start && clock.minutes < start + CATCH_UP_MINUTES;
  });
  return { date: clock.date, slots };
}
