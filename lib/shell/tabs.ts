/**
 * The app's tabs, its settings sections, and how a URL maps onto them. Pure,
 * so the routing rules, including every link from the older six-tab layout, are
 * tested rather than remembered.
 */

export type TabId = 'today' | 'money' | 'health' | 'journal' | 'social' | 'career';
export type MoneyView = 'spending' | 'investments';
export type SettingsSection = 'you' | 'connections' | 'ai' | 'notifications' | 'day' | 'security' | 'privacy' | 'data';

export const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: 'money', label: 'Money' },
  { id: 'health', label: 'Health' },
  { id: 'journal', label: 'Journal' },
  { id: 'social', label: 'Social' },
  { id: 'career', label: 'Career' },
];

export type SettingsCategory = 'account' | 'preferences' | 'apps' | 'privacy';

/**
 * Settings' sections, grouped the way Instagram's or YouTube's settings are:
 * who you are, how Orbis behaves for you, what it is connected to, and what it
 * can see and keeps. The labels stay as they are, since copy across the app
 * points at them ("Settings → What Orbis can see").
 */
export const SETTINGS_CATEGORIES: ReadonlyArray<{ id: SettingsCategory; label: string; sections: readonly SettingsSection[] }> = [
  { id: 'account', label: 'Your account', sections: ['you', 'security'] },
  { id: 'preferences', label: 'Preferences', sections: ['notifications', 'day', 'ai'] },
  { id: 'apps', label: 'Connected apps', sections: ['connections'] },
  { id: 'privacy', label: 'Privacy and data', sections: ['privacy', 'data'] },
];

const SECTION_COPY: Record<SettingsSection, { label: string; description: string }> = {
  you: { label: 'You', description: 'Your name, what you do, your home city' },
  security: { label: 'Security', description: 'Device PIN and locking Orbis' },
  notifications: { label: 'Notifications', description: 'Four daily check-ins and their times' },
  day: { label: 'Your day', description: 'Routines and their times' },
  ai: { label: 'AI & privacy', description: 'The AI switch, the brief, heads-ups' },
  connections: { label: 'Connections', description: 'Google, banks, social apps, services' },
  privacy: { label: 'What Orbis can see', description: 'What Orbis reads on your phone' },
  data: { label: 'Your data', description: 'Download, delete, sign out' },
};

/** Every section, in its category's order: the order the index lists them and the sheet stacks them. */
export const SETTINGS_SECTIONS: Array<{ id: SettingsSection; label: string; description: string; category: SettingsCategory }> =
  SETTINGS_CATEGORIES.flatMap((category) => category.sections.map((id) => ({ id, ...SECTION_COPY[id], category: category.id })));

export type Opening = { tab: TabId; money?: MoneyView; settings?: SettingsSection };

// The part of the hash before any '/'. Old names map to where that screen lives now.
// A Map, not a plain object: a Record is reachable through the prototype chain
// too ('#constructor', '?tab=toString'), so a lookup by an untrusted string can
// return Object.prototype's own methods instead of failing closed.
const BY_HASH: Map<string, Opening> = new Map([
  ['today', { tab: 'today' }],
  ['home', { tab: 'today' }],
  // Bare #money is what the PWA shortcut and a same-document hashchange land
  // on; it must say Spending explicitly, not just "money", so switching back
  // to it from Investments actually changes the view.
  ['money', { tab: 'money', money: 'spending' }],
  ['finance', { tab: 'money', money: 'spending' }],
  ['invest', { tab: 'money', money: 'investments' }],
  ['health', { tab: 'health' }],
  ['journal', { tab: 'journal' }],
  ['social', { tab: 'social' }],
  ['career', { tab: 'career' }],
  ['profile', { tab: 'today', settings: 'you' }],
]);

// ?tab= values sent by the OAuth callbacks, old and new.
const BY_PARAM: Map<string, Opening> = new Map([
  ['today', { tab: 'today' }],
  ['home', { tab: 'today' }],
  ['money', { tab: 'money' }],
  ['finance', { tab: 'money', money: 'spending' }],
  ['invest', { tab: 'money', money: 'investments' }],
  ['investments', { tab: 'money', money: 'investments' }],
  ['settings', { tab: 'today', settings: 'connections' }],
  // Career's Gmail "Allow sending" round trip lands back on the tab.
  ['career', { tab: 'career' }],
  // Onboarding's "Finish and open Security".
  ['security', { tab: 'today', settings: 'security' }],
]);

/** Where a URL asks the app to open, or null for the default. `?tab=` wins over the hash. */
export function openingFromUrl(hash: string, tabParam: string | null): Opening | null {
  if (tabParam) return BY_PARAM.get(tabParam) ?? null;
  const [name, rest] = hash.replace(/^#/, '').split('/');
  const opening = BY_HASH.get(name);
  if (!opening) return null;
  if (name === 'money' && rest === 'investments') return { tab: 'money', money: 'investments' };
  return opening;
}

/** The hash the app writes for what is on screen; Today is the bare URL. */
export function hashFor(tab: TabId, money: MoneyView = 'spending'): string {
  if (tab === 'today') return '';
  if (tab === 'money' && money === 'investments') return '#money/investments';
  return `#${tab}`;
}

/**
 * A link into the app that opens `tab`, for pages outside it (the Career
 * panel's rail). Today is named rather than left bare, so the hash is never
 * empty and a same-page click still fires hashchange.
 */
export function appHref(tab: TabId, money: MoneyView = 'spending'): string {
  return `/active${hashFor(tab, money) || '#today'}`;
}
