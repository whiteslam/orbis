// When a pause from Settings → Phone access ends, as the epoch milliseconds
// OrbisCore.pause({ until }) takes. Pure, so the "tomorrow" rule is tested.

import { PAUSED_FOREVER } from './orbis-core';

export type PauseChoice = 'hour' | 'tomorrow' | 'forever';

const HOUR_MS = 3_600_000;
const MORNING_HOUR = 6;

/**
 * - `hour`: an hour from now;
 * - `tomorrow`: 06:00 local time on the next calendar date (so 01:00 pauses until
 *   06:00 the day after, never five hours later);
 * - `forever`: until turned back on (-1).
 */
export function pauseUntil(choice: PauseChoice, now: Date): number {
  if (choice === 'hour') return now.getTime() + HOUR_MS;
  if (choice === 'forever') return PAUSED_FOREVER;
  const morning = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, MORNING_HOUR, 0, 0, 0);
  return morning.getTime();
}
