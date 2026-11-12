/**
 * Which tabs a person sees. Today is always there; every other tab is a
 * module they chose (lib/locale/person.ts). Pure, so the rule is tested.
 */

import { ALL_MODULES, type ModuleId, type PersonSettings } from '@/lib/locale/person';
import { TABS, type TabId } from '@/lib/shell/tabs';

const DETAIL: Record<ModuleId, string> = {
  money: 'Spending, budgets and investments.',
  health: 'Steps, health documents and plans.',
  journal: 'Entries, moods and saved notes.',
  social: 'A month of posts, planned ahead.',
  career: 'Jobs, applications and replies.',
};

/** Every module with its tab's name and one line on what it holds, in tab order. */
export const MODULES: Array<{ id: ModuleId; label: string; detail: string }> = ALL_MODULES.map((id) => ({
  id,
  label: TABS.find((tab) => tab.id === id)?.label ?? id,
  detail: DETAIL[id],
}));

/** Today first, then the tab of each chosen module, in tab order. */
export function visibleTabs(modules: readonly ModuleId[]): TabId[] {
  return TABS.map((tab) => tab.id).filter((id) => id === 'today' || (modules as readonly string[]).includes(id));
}

/** The tab to show: the one asked for, or Today when its module is switched off. */
export function shownTab(tab: TabId, modules: readonly ModuleId[]): TabId {
  return visibleTabs(modules).includes(tab) ? tab : 'today';
}

/** A module list sent from the browser: known ids only, once each, in tab order; null when anything else is in it. */
export function parseModules(value: unknown): ModuleId[] | null {
  if (!Array.isArray(value)) return null;
  if (!value.every((item) => typeof item === 'string' && (ALL_MODULES as string[]).includes(item))) return null;
  return ALL_MODULES.filter((id) => value.includes(id));
}

/** The Career panel (/active/career) opens only for someone who finished onboarding and kept Career on. */
export function careerPanelOpen(settings: Pick<PersonSettings, 'modules' | 'onboardedAt'>): boolean {
  return settings.onboardedAt !== null && settings.modules.includes('career');
}
