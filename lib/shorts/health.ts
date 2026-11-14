// The Shorts health card: five lines that say whether the chain from the PC to
// the channel is working. Pure and client-safe; app/shorts/actions.ts gathers the input.

import { localDate, localParts } from '@/lib/locale/dates';
import { shelfDaysLeft } from '@/lib/shorts/shelf';
import type { WorkerPresence } from '@/lib/shorts/types';

export type HealthInput = {
  now: Date;
  worker: { presence: WorkerPresence; note: string | null; lastSeen: string | null };
  youtube: {
    state: 'not_set_up' | 'not_connected' | 'reconnect' | 'connected';
    onShelf: number;
    postsPerDay: number;
    nextPost: Date | null;
    paused: boolean;
    holdUntil: string | null;
    timeZone: string;
  };
  failedBuilds24h: number;
  failedPosts24h: number;
};

export type HealthLine = { key: 'shelf' | 'next' | 'pc' | 'accounts' | 'problems'; label: string; text: string; tone: 'ok' | 'warn' | 'bad' };

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** "7:00 pm" on the zone's clock. */
function clock(at: Date, timeZone: string): string {
  const { hour, minute } = localParts(at, timeZone);
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'am' : 'pm'}`;
}

/** "Today", "Tomorrow" or the weekday, on the zone's calendar. */
function dayWord(at: Date, now: Date, timeZone: string): string {
  const day = localDate(at, timeZone);
  if (day === localDate(now, timeZone)) return 'Today';
  if (day === localDate(new Date(now.getTime() + 86_400_000), timeZone)) return 'Tomorrow';
  return WEEKDAYS[localParts(at, timeZone).weekday];
}

/** Days rounded down to the half: 2.5 → "2½ days", 0.5 → "½ day", 1 → "1 day". */
function halfDays(days: number): string {
  const halves = Math.floor(days * 2);
  const whole = Math.floor(halves / 2);
  const number = halves % 2 ? `${whole || ''}½` : String(whole);
  return `${number} ${halves <= 2 ? 'day' : 'days'}`;
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function shortsHealth(input: HealthInput): HealthLine[] {
  const { now, worker, youtube } = input;

  const days = shelfDaysLeft({ destination: 'youtube', postsPerDay: youtube.postsPerDay, onShelf: youtube.onShelf });
  const shelf: HealthLine = {
    key: 'shelf',
    label: 'Shelf',
    text: youtube.onShelf > 0 ? `YouTube ${youtube.onShelf} · about ${halfDays(days)}` : 'YouTube 0 · none ready',
    tone: days < 1 ? 'warn' : 'ok',
  };

  let nextText = '—';
  if (youtube.paused) nextText = 'Paused';
  else if (youtube.nextPost) nextText = `YouTube ${dayWord(youtube.nextPost, now, youtube.timeZone)} ${clock(youtube.nextPost, youtube.timeZone)}`;
  const next: HealthLine = { key: 'next', label: 'Next post', text: nextText, tone: 'ok' };

  let pc: HealthLine;
  if (worker.presence === 'none') pc = { key: 'pc', label: 'PC', text: 'Not set up', tone: 'warn' };
  else if (worker.presence === 'offline') {
    const seen = worker.lastSeen ? new Date(worker.lastSeen) : null;
    const since = seen && !Number.isNaN(seen.getTime())
      ? ` since ${dayWord(seen, now, youtube.timeZone) === 'Today' ? '' : `${dayWord(seen, now, youtube.timeZone)} `}${clock(seen, youtube.timeZone)}`
      : '';
    pc = { key: 'pc', label: 'PC', text: `Offline${since}`, tone: 'bad' };
  } else {
    // Paused (Claude Code needs attention) or setting up: online, but not making shorts.
    const tone = worker.presence === 'paused' || worker.presence === 'setup' ? 'warn' : 'ok';
    pc = { key: 'pc', label: 'PC', text: worker.note ? `Online · ${worker.note}` : 'Online', tone };
  }

  const accounts: HealthLine = { key: 'accounts', label: 'Accounts', text: 'YouTube connected', tone: 'ok' };
  if (youtube.state === 'reconnect') Object.assign(accounts, { text: 'YouTube needs connecting again', tone: 'bad' });
  else if (youtube.state !== 'connected') Object.assign(accounts, { text: 'YouTube not connected', tone: 'warn' });

  const parts: string[] = [];
  if (input.failedBuilds24h > 0) parts.push(`${count(input.failedBuilds24h, 'build', 'builds')} failed`);
  if (input.failedPosts24h > 0) parts.push(`${count(input.failedPosts24h, 'post', 'posts')} failed`);
  if (youtube.holdUntil && new Date(youtube.holdUntil).getTime() > now.getTime()) parts.push('YouTube daily limit hit');
  const problems: HealthLine = parts.length
    ? { key: 'problems', label: 'Problems', text: parts.join(' · '), tone: 'warn' }
    : { key: 'problems', label: 'Problems', text: 'None in the last 24 h', tone: 'ok' };

  return [shelf, next, pc, accounts, problems];
}
