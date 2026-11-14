// The shelf: finished shorts waiting to post, per platform. The PC worker asks
// decideStart once a minute whether to start the next autopilot short, and for
// which platform. Pure and client-safe. Relative imports only, because the PC
// worker loads this file with plain Node.

import { localDate, localParts } from '../locale/dates.ts';
import type { Autopilot } from './autopilot.ts';
import type { Destination } from './types.ts';

/** One platform's shelf: its posts a day (at least 1) and what will still post, made or being made. */
export type ShelfCount = { destination: Destination; postsPerDay: number; onShelf: number };

const minutesOf = (time: string) => {
  const [hour, minute] = time.split(':').map(Number);
  return (Number.isFinite(hour) ? hour : 0) * 60 + (Number.isFinite(minute) ? minute : 0);
};

/**
 * Whether now, on the person's clock, is inside [windowStart, windowEnd). A window
 * whose end is earlier than its start crosses midnight; the same time for both means any time.
 */
export function inWindow(windowStart: string, windowEnd: string, now: Date, timeZone: string): boolean {
  const start = minutesOf(windowStart);
  const end = minutesOf(windowEnd);
  if (start === end) return true;
  const parts = localParts(now, timeZone);
  const at = parts.hour * 60 + parts.minute;
  return start < end ? at >= start && at < end : at >= start || at < end;
}

/** How many days of posts the shelf holds. */
export function shelfDaysLeft(shelf: ShelfCount): number {
  return shelf.onShelf / Math.max(1, shelf.postsPerDay);
}

/** Autopilot shorts that may start in one local day: a day's posts on every platform, plus one to replace a failure. */
export function dailyCap(shelves: ShelfCount[]): number {
  return shelves.reduce((sum, shelf) => sum + Math.max(1, shelf.postsPerDay), 0) + 1;
}

/** The platform whose shelf is lowest in days and still below its target; YouTube on a tie. */
export function pickDestination(shelves: ShelfCount[], shelfDays: number): Destination | null {
  let best: ShelfCount | null = null;
  for (const shelf of shelves) {
    if (shelf.onShelf >= shelfDays * Math.max(1, shelf.postsPerDay)) continue;
    const days = shelfDaysLeft(shelf);
    if (!best) best = shelf;
    else {
      const bestDays = shelfDaysLeft(best);
      if (days < bestDays || (days === bestDays && shelf.destination === 'youtube')) best = shelf;
    }
  }
  return best?.destination ?? null;
}

export type StartDecision = { today: string; destination: Destination; cap: number };

/**
 * Whether to start an autopilot short now, and for which platform. `shelves` holds
 * only the platforms switched on that can post. The cap is enforced by the caller,
 * through the guarded counter in the database.
 */
export function decideStart(input: { autopilot: Autopilot; now: Date; inProgress: number; shelves: ShelfCount[] }): StartDecision | null {
  const { autopilot, now, inProgress, shelves } = input;
  if (!autopilot.enabled || inProgress > 0) return null;
  if (!inWindow(autopilot.windowStart, autopilot.windowEnd, now, autopilot.timezone)) return null;
  const destination = pickDestination(shelves, autopilot.shelfDays);
  if (!destination) return null;
  return { today: localDate(now, autopilot.timezone), destination, cap: dailyCap(shelves) };
}
