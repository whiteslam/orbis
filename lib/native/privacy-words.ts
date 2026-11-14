// The words and small rules behind Settings → Phone access
// (components/settings/privacy-center.tsx). Pure and client-safe, so it is tested
// in Node: the phone's codes (wire names, drop reasons) never reach the screen raw.

import { SOURCES, type Source } from '@/lib/device/sources';
import type { ActivityEntry, CoreStatus, LauncherApp } from './orbis-core';

export const SOURCE_LABELS: Record<Source, string> = {
  test: 'Test source',
  notifications: 'Notifications',
  calendar: 'Calendar',
  contacts: 'Contacts',
  calls: 'Calls',
  health: 'Health',
  usage: 'App usage',
  phone_state: 'Battery and connection',
  location: 'Location',
};

// Only these sources read anything in this version; the others are listed so people see what is coming.
export const READY: ReadonlySet<Source> = new Set<Source>(['test', 'notifications']);

export type TurnOnWords = { title: string; read: string; kept: string; goes: string; next: string };

/** What turning a source on means, said before it happens. Every READY source has an entry. */
export const TURN_ON_WORDS: Partial<Record<Source, TurnOnWords>> = {
  test: {
    title: 'Turn on Test source?',
    read: 'Only the made-up items you send from Try it below. Nothing else on this phone.',
    kept: 'Each item, in Orbis’s encrypted store, for 30 days.',
    goes: 'A short, encrypted signal, with codes and passwords masked.',
    next: 'Nothing else needs setting up.',
  },
  notifications: {
    title: 'Read your notifications',
    read: 'The title and text of notifications that arrive on this phone. Blocked apps and contacts are skipped, and banking apps start blocked. Bank and UPI text messages are read unless you block the sender.',
    kept: 'The text stays on this phone, encrypted, for 30 days. Card and account numbers are hidden first, and one-time codes are never kept.',
    goes: 'Only what Orbis sorts out leaves the phone, encrypted: payments for you to review in Money, deliveries, missed calls and job mail.',
    next: 'Next, tap Open notification access and turn Orbis on in the Android screen that opens. If Android says the setting is restricted, open App info for Orbis, tap the menu, and choose Allow restricted settings.',
  },
};

/**
 * The words for the two blocked lists. A notification shows a saved contact by name, so a
 * blocked contact is a number or a name exactly as notifications show it; the phone keeps a
 * number's last 10 digits, or the name in lower case.
 */
export const BLOCKED_LIST_WORDS = {
  blockedContacts: {
    title: 'Blocked contacts',
    label: 'Phone number or name',
    placeholder: 'e.g. 98765 43210 or Asha Rao',
    inputMode: 'text',
    note: 'Nothing to or from these is read. Add a phone number, or a name exactly as it shows in your notifications. Numbers are matched by their last 10 digits.',
    refused: 'That couldn’t be added.',
  },
  blockedKeywords: {
    title: 'Blocked words',
    label: 'Word or phrase',
    placeholder: 'e.g. salary',
    inputMode: 'text',
    note: 'An item that contains one of these is never kept.',
    refused: 'That couldn’t be added.',
  },
} as const;

const WIRE_NAMES: ReadonlySet<string> = new Set(SOURCES);

/** True for the nine wire names only. */
export function isSource(value: unknown): value is Source {
  return typeof value === 'string' && WIRE_NAMES.has(value);
}

// Map, not a Record: an unknown code must never resolve through Object.prototype.
const REASONS: Map<string, string> = new Map([
  ['OTHER_PROFILE', 'From a work or private profile'],
  ['PAUSED', 'Orbis was paused'],
  ['SOURCE_OFF', 'The source was off'],
  ['BLOCKED_APP', 'From a blocked app'],
  ['BLOCKED_CONTACT', 'From a blocked contact'],
  ['BLOCKED_KEYWORD', 'Had a blocked word'],
  ['ONE_TIME_CODE', 'One-time code'],
]);
const OTHER_REASON = 'Left out by a rule';

/** Why an item was dropped, in words; a code this page doesn't know never shows raw. */
export function reasonWords(reason: string | undefined): string {
  return (reason && REASONS.get(reason)) || OTHER_REASON;
}

/** One line of recent activity: never content, only source, decision and why. */
export function activityWords(entry: ActivityEntry): { source: string; decision: 'Kept' | 'Dropped'; reason: string | null } {
  const source = isSource(entry.source) ? SOURCE_LABELS[entry.source] : 'Other';
  if (entry.decision === 'kept') return { source, decision: 'Kept', reason: null };
  return { source, decision: 'Dropped', reason: reasonWords(entry.reason) };
}

export type PauseState = { kind: 'off' } | { kind: 'forever' } | { kind: 'until'; at: number };

/** The phone's `pausedUntil` (null, -1 or epoch ms) as of `now`; a pause that has run out is off. */
export function pauseState(pausedUntil: number | null, now: number): PauseState {
  if (pausedUntil === null) return { kind: 'off' };
  if (pausedUntil === -1) return { kind: 'forever' };
  return pausedUntil > now ? { kind: 'until', at: pausedUntil } : { kind: 'off' };
}

// The phone refuses a whole setPrivacy call over these (PluginInput.kt), so they are checked first.
export const MAX_LIST_ITEMS = 500;
export const MAX_ITEM_CHARS = 200;

/** `list` with `raw` added, trimmed; unchanged when it is blank, already there (any case), too long or the list is full. */
export function addToList(list: readonly string[], raw: string): string[] {
  const item = raw.trim();
  const known = list.some((entry) => entry.toLowerCase() === item.toLowerCase());
  if (!item || known || item.length > MAX_ITEM_CHARS || list.length >= MAX_LIST_ITEMS) return [...list];
  return [...list, item];
}

/** The blocked packages with `packageName` ticked or not; packages for apps not installed stay as they are. */
export function toggleBlocked(blocked: readonly string[], packageName: string, on: boolean): string[] {
  if (!on) return blocked.filter((item) => item !== packageName);
  return blocked.includes(packageName) ? [...blocked] : [...blocked, packageName];
}

/** Blocked apps first, then the rest, each by name. */
export function blockedFirst(apps: readonly LauncherApp[], blocked: readonly string[]): LauncherApp[] {
  const isBlocked = new Set(blocked);
  return [...apps].sort((a, b) => Number(isBlocked.has(b.packageName)) - Number(isBlocked.has(a.packageName)) || a.label.localeCompare(b.label));
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** When a phone last synced, in words: "Just now", "5 minutes ago", "Yesterday", "10 days ago". */
export function lastSeenWords(iso: string | null, now: number): string {
  const at = iso ? Date.parse(iso) : Number.NaN;
  if (!Number.isFinite(at)) return 'Not synced yet';
  const ago = now - at;
  if (ago < 2 * MINUTE) return 'Just now';
  if (ago < HOUR) return `${Math.floor(ago / MINUTE)} minutes ago`;
  if (ago < DAY) {
    const hours = Math.floor(ago / HOUR);
    return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
  }
  const days = Math.floor(ago / DAY);
  return days === 1 ? 'Yesterday' : `${days} days ago`;
}

// The phone's short sync-failure codes that aren't words already (SyncRunner: "network",
// "storage"); "HTTP 503" and "unexpected response" are shown as they are.
const SYNC_ERRORS: Record<string, string> = {
  network: 'no connection',
  storage: 'this phone’s storage was busy',
};

/**
 * This phone's sync in one line: "Last synced 5 minutes ago · 3 waiting", with
 * "· Couldn’t sync: unexpected response" added while the last try failed.
 */
export function syncWords(status: Pick<CoreStatus, 'lastSyncAt' | 'pendingSignals' | 'lastSyncError'>, now: number): string {
  const when = status.lastSyncAt === null ? null : new Date(status.lastSyncAt).toISOString();
  const parts = [when ? `Last synced ${lastSeenWords(when, now).toLowerCase()}` : 'Not synced yet'];
  if (status.pendingSignals > 0) parts.push(`${status.pendingSignals} waiting`);
  const error = status.lastSyncError?.trim();
  if (error) parts.push(`Couldn’t sync: ${Object.hasOwn(SYNC_ERRORS, error) ? SYNC_ERRORS[error] : error}`);
  return parts.join(' · ');
}
