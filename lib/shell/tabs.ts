/**
 * The app's tabs, its settings sections, and how a URL maps onto them. Pure,
 * so the routing rules, including every link from the six-tab layout, are
 * tested rather than remembered.
 */

export type TabId = 'today' | 'money' | 'health' | 'journal' | 'social';
export type MoneyView = 'spending' | 'investments';
export type SettingsSection = 'you' | 'connections' | 'ai' | 'notifications' | 'day' | 'security' | 'data';

export const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: 'money', label: 'Money' },
  { id: 'health', label: 'Health' },
  { id: 'journal', label: 'Journal' },
  { id: 'social', label: 'Social' },
];

export const SETTINGS_SECTIONS: Array<{ id: SettingsSection; label: string }> = [
  { id: 'you', label: 'You' },
  { id: 'connections', label: 'Connections' },
  { id: 'ai', label: 'AI & privacy' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'day', label: 'Your day' },
  { id: 'security', label: 'Security' },
  { id: 'data', label: 'Your data' },
];

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
