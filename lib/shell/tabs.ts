/**
 * The app's tabs, its settings sections, and how a URL maps onto them. Pure,
 * so the routing rules, including every link from the older six-tab layout, are
 * tested rather than remembered.
 */

export type TabId = 'today' | 'money' | 'health' | 'journal' | 'social' | 'career';
export type MoneyView = 'spending' | 'investments';
export type SettingsSection = 'you' | 'connections' | 'ai' | 'notifications' | 'day' | 'region' | 'tabs' | 'security' | 'privacy' | 'data';

export const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: 'money', label: 'Money' },
  { id: 'health', label: 'Health' },
  { id: 'journal', label: 'Journal' },
  { id: 'social', label: 'Social' },
  { id: 'career', label: 'Career' },
];

export type SettingsCategory = 'account' | 'preferences' | 'apps';

/**
 * Settings' sections, grouped the way Instagram's or YouTube's settings are:
 * you and your account, how Orbis behaves for you, and what it is connected to.
 * Copy elsewhere points at these labels ("Settings → Phone access"); rename them together.
 */
export const SETTINGS_CATEGORIES: ReadonlyArray<{ id: SettingsCategory; label: string; sections: readonly SettingsSection[] }> = [
  { id: 'account', label: 'You', sections: ['you', 'security', 'data'] },
  { id: 'preferences', label: 'Preferences', sections: ['notifications', 'day', 'ai', 'region', 'tabs'] },
  { id: 'apps', label: 'Apps and devices', sections: ['connections', 'privacy'] },
];

const SECTION_COPY: Record<SettingsSection, { label: string; description: string }> = {
  you: { label: 'Profile', description: 'Name, role, about you' },
  security: { label: 'Security', description: 'PIN and lock' },
  data: { label: 'Account', description: 'Sign out, export, delete' },
  notifications: { label: 'Notifications', description: 'Check-ins and heads-ups' },
  day: { label: 'Routines', description: 'Fixed times in your day' },
  ai: { label: 'AI', description: 'AI switch and the brief' },
  region: { label: 'Region', description: 'Time zone, currency, home city' },
  tabs: { label: 'Tabs', description: 'Which tabs show' },
  connections: { label: 'Connected apps', description: 'Google, Health, social apps' },
  privacy: { label: 'Phone access', description: 'What the Android app reads' },
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
