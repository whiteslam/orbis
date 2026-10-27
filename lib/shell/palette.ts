/**
 * What the desktop command palette (Ctrl/⌘+K) can jump to: every tab, Money's
 * two views, every Settings section, the Career panel's pages, and Ask Orbis.
 * Pure, so the list and its ranking are tested; the shell turns `go` into the
 * same state changes a rail click makes.
 */

import { SETTINGS_SECTIONS, TABS, type MoneyView, type SettingsSection, type TabId } from '@/lib/shell/tabs';

export type PaletteGo =
  | { to: 'tab'; tab: TabId; money?: MoneyView }
  | { to: 'settings'; section: SettingsSection }
  | { to: 'href'; href: string }
  | { to: 'ask' };

export type AppPaletteItem = {
  id: string;
  label: string;
  detail: string;
  kind: 'tab' | 'view' | 'settings' | 'career' | 'action';
  go: PaletteGo;
};

// On desktop Career is the full panel, so its tab entry leaves for it.
const CAREER_PANEL = '/active/career';

/** Every place the palette knows. `careerPages` are the panel's pages (PANEL_PAGES), passed in so lib/ stays free of components. */
export function appPalette(careerPages: ReadonlyArray<{ id: string; label: string }>): AppPaletteItem[] {
  const tabs: AppPaletteItem[] = TABS.map(({ id, label }) => ({
    id: `tab-${id}`,
    label,
    detail: id === 'career' ? 'Open the Career panel' : 'Go to tab',
    kind: 'tab',
    go: id === 'career' ? { to: 'href', href: CAREER_PANEL } : { to: 'tab', tab: id },
  }));
  const views: AppPaletteItem[] = [
    { id: 'view-spending', label: 'Spending', detail: 'Money', kind: 'view', go: { to: 'tab', tab: 'money', money: 'spending' } },
    { id: 'view-investments', label: 'Investments', detail: 'Money', kind: 'view', go: { to: 'tab', tab: 'money', money: 'investments' } },
  ];
  const settings: AppPaletteItem[] = SETTINGS_SECTIONS.map(({ id, label }) => ({ id: `settings-${id}`, label, detail: 'Settings', kind: 'settings', go: { to: 'settings', section: id } }));
  const career: AppPaletteItem[] = careerPages.map(({ id, label }) => ({ id: `career-${id}`, label, detail: 'Career panel', kind: 'career', go: { to: 'href', href: `${CAREER_PANEL}#/${id}` } }));
  const ask: AppPaletteItem = { id: 'action-ask', label: 'Ask Orbis', detail: 'Ask about your spending, journal, routines or steps', kind: 'action', go: { to: 'ask' } };
  return [...tabs, ...views, ...settings, ...career, ask];
}

/**
 * Items whose label or detail holds every word of `query`, best first: the
 * label starts with the first word, then contains it, then the rest. An empty
 * query lists the first `limit` items as they come.
 */
export function rankPalette<T extends { label: string; detail: string }>(items: readonly T[], query: string, limit = 12): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return items.slice(0, limit);
  const scored = items.flatMap((item) => {
    const label = item.label.toLowerCase();
    if (!words.every((word) => `${label} ${item.detail.toLowerCase()}`.includes(word))) return [];
    let rank = 2;
    if (label.startsWith(words[0])) rank = 0;
    else if (label.includes(words[0])) rank = 1;
    return [{ item, rank }];
  });
  return scored.sort((left, right) => left.rank - right.rank).slice(0, limit).map((entry) => entry.item);
}
