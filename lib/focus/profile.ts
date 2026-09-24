// What the Profile tab says about you.
//
// Every other tab opens with a decision. Profile opens with a person: who Orbis
// thinks you are, then what you have chosen to tell it.
//
// It used to open with connection status — Gmail, Calendar, Groww, Health — which
// made Profile a read-only mirror of Settings. Those rows are gone: Settings
// already shows that state inside the groups that change it, and a status list
// is not an identity.

import { count } from '@/lib/focus/types';
import type { QuietRow } from '@/lib/focus/types';
import type { JournalSummary } from '@/lib/journal/types';
import type { PersonalProfile } from '@/lib/personal/repository';
import type { AppConnections } from '@/lib/providers/status';

export type ProfileInput = {
  profile: PersonalProfile | null;
  /** A saved fitness coaching style. Health is the only thing that reads it. */
  hasCoachingStyle: boolean;
  noteCount: number;
  journal: JournalSummary;
  connections: AppConnections;
};

/** Gmail, Calendar and Groww are the three links you make yourself. */
export function connectedCount({ google, groww }: AppConnections) {
  return [google?.gmail, google?.calendar, Boolean(groww)].filter(Boolean).length;
}

export function words(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** The letter in the avatar, or a dot while there is no name to take one from. */
export function initialOf(name: string | null | undefined) {
  const letter = name?.trim()?.[0];
  return letter ? letter.toUpperCase() : '·';
}

function sentenceList(parts: string[]) {
  if (parts.length < 2) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/**
 * Chips beside your name. Only what is true shows up, so an empty profile is
 * quiet. The streak is the one that carries the accent — it is the only chip
 * that decays if you stop, so it is the only one worth a colour.
 */
export function composeIdentityMeta(input: ProfileInput): Array<{ key: string; label: string; accent: boolean }> {
  const chips: Array<{ key: string; label: string; accent: boolean }> = [];
  if (input.journal.streak > 0) chips.push({ key: 'streak', label: `${count(input.journal.streak, 'day')} journalling`, accent: true });
  if (input.noteCount) chips.push({ key: 'notes', label: count(input.noteCount, 'saved note'), accent: false });
  const connected = connectedCount(input.connections);
  if (connected) chips.push({ key: 'apps', label: `${connected} of 3 apps connected`, accent: false });
  return chips;
}

/**
 * One line under your name: what Orbis holds, and the rule it holds it under.
 * The privacy rule is stated here once — the editors below no longer repeat it.
 */
export function composeProfileSummary(input: ProfileInput): string {
  if (!input.profile) {
    return 'Orbis holds nothing about you yet. A name and one line about what you do is enough to change how every other tab reads.';
  }
  const held: string[] = [];
  const about = words(input.profile.aboutMe);
  if (about) held.push(`${count(about, 'word')} about you`);
  if (input.hasCoachingStyle) held.push('a coaching style for Health');
  if (input.noteCount) held.push(count(input.noteCount, 'saved note'));
  if (!held.length) {
    return 'Your name and role, and nothing else so far. Everything below is optional, stays in your account, and is only sent with a request when you tick the box for it.';
  }
  return `Orbis holds ${sentenceList(held)}. All of it stays in your account, and is only sent with a request when you tick the box for it.`;
}

/**
 * The glance above the editors. Deliberately none of these repeat your name or
 * role — the identity block above already carries those.
 */
export function composeProfileRows(input: ProfileInput): QuietRow[] {
  const about = input.profile ? words(input.profile.aboutMe) : 0;
  const connected = connectedCount(input.connections);
  return [
    { label: 'About you', value: about ? count(about, 'word') : 'Nothing written', empty: !about, target: null },
    { label: 'Coaching style', value: input.hasCoachingStyle ? 'Saved' : 'Not set', empty: !input.hasCoachingStyle, target: null },
    { label: 'Saved notes', value: input.noteCount ? String(input.noteCount) : 'None yet', empty: !input.noteCount, target: null },
    { label: 'Journal entries', value: input.journal.entries.length ? String(input.journal.entries.length) : 'None yet', empty: !input.journal.entries.length, target: null },
    { label: 'Connected apps', value: connected ? `${connected} of 3` : 'None yet', empty: !connected, target: null },
  ];
}
