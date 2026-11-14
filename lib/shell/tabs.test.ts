import { describe, expect, it } from 'vitest';
import { appHref, hashFor, openingFromUrl, SETTINGS_CATEGORIES, SETTINGS_SECTIONS, TABS } from '@/lib/shell/tabs';

describe('TABS', () => {
  it('lists the six tabs in order, one name each', () => {
    expect(TABS.map((tab) => tab.id)).toEqual(['today', 'money', 'health', 'journal', 'social', 'career']);
    expect(TABS.map((tab) => tab.label)).toEqual(['Today', 'Money', 'Health', 'Journal', 'Social', 'Career']);
  });
});

describe('SETTINGS_SECTIONS', () => {
  it('lists the ten sections in category order, the order the sheet shows them', () => {
    expect(SETTINGS_SECTIONS.map((section) => section.id)).toEqual(['you', 'security', 'data', 'notifications', 'day', 'ai', 'region', 'tabs', 'connections', 'privacy']);
    // The labels are what copy across the app points at ("Settings → Phone access"), so they hold.
    expect(SETTINGS_SECTIONS.map((section) => section.label)).toEqual(['Profile', 'Security', 'Account', 'Notifications', 'Routines', 'AI', 'Region', 'Tabs', 'Connected apps', 'Phone access']);
  });

  it('gives every section a short one-line description', () => {
    for (const section of SETTINGS_SECTIONS) {
      expect(section.description.trim()).not.toBe('');
      expect(section.description.length).toBeLessThanOrEqual(40);
    }
  });

  it('puts Phone access with Connected apps, and Account with Profile', () => {
    expect(SETTINGS_SECTIONS.find((section) => section.id === 'privacy')).toMatchObject({ label: 'Phone access', category: 'apps' });
    expect(SETTINGS_SECTIONS.find((section) => section.id === 'data')).toMatchObject({ label: 'Account', category: 'account' });
  });
});

describe('SETTINGS_CATEGORIES', () => {
  it('names three categories, in order', () => {
    expect(SETTINGS_CATEGORIES.map((category) => category.label)).toEqual(['You', 'Preferences', 'Apps and devices']);
  });

  it('holds every section exactly once, in the order SETTINGS_SECTIONS lists them', () => {
    const flat = SETTINGS_CATEGORIES.flatMap((category) => category.sections);
    expect(flat).toEqual(SETTINGS_SECTIONS.map((section) => section.id));
    expect(new Set(flat).size).toBe(10);
    for (const category of SETTINGS_CATEGORIES) {
      expect(category.sections.length).toBeGreaterThan(0);
      for (const id of category.sections) expect(SETTINGS_SECTIONS.find((section) => section.id === id)?.category).toBe(category.id);
    }
  });
});

describe('openingFromUrl', () => {
  it('opens the current hashes', () => {
    expect(openingFromUrl('#money', null)).toEqual({ tab: 'money', money: 'spending' });
    expect(openingFromUrl('#money/investments', null)).toEqual({ tab: 'money', money: 'investments' });
    expect(openingFromUrl('#journal', null)).toEqual({ tab: 'journal' });
    expect(openingFromUrl('#social/2026-09', null)).toEqual({ tab: 'social' });
    expect(openingFromUrl('#career', null)).toEqual({ tab: 'career' });
  });

  it('keeps every hash from the six-tab layout working', () => {
    expect(openingFromUrl('#home', null)).toEqual({ tab: 'today' });
    expect(openingFromUrl('#finance', null)).toEqual({ tab: 'money', money: 'spending' });
    expect(openingFromUrl('#invest', null)).toEqual({ tab: 'money', money: 'investments' });
    expect(openingFromUrl('#profile', null)).toEqual({ tab: 'today', settings: 'you' });
  });

  it('lets ?tab= from an OAuth return win over the hash, old values included', () => {
    expect(openingFromUrl('#health', 'settings')).toEqual({ tab: 'today', settings: 'connections' });
    expect(openingFromUrl('', 'home')).toEqual({ tab: 'today' });
    expect(openingFromUrl('', 'today')).toEqual({ tab: 'today' });
    expect(openingFromUrl('', 'finance')).toEqual({ tab: 'money', money: 'spending' });
    expect(openingFromUrl('', 'invest')).toEqual({ tab: 'money', money: 'investments' });
    expect(openingFromUrl('', 'investments')).toEqual({ tab: 'money', money: 'investments' });
    expect(openingFromUrl('#today', 'career')).toEqual({ tab: 'career' });
  });

  it('opens Settings → Security from ?tab=security, where onboarding sends anyone who asks to review their PIN', () => {
    expect(openingFromUrl('', 'security')).toEqual({ tab: 'today', settings: 'security' });
  });

  it('ignores anything it does not know', () => {
    expect(openingFromUrl('', null)).toBeNull();
    expect(openingFromUrl('#nope', null)).toBeNull();
    expect(openingFromUrl('#settings-you', null)).toBeNull();
    expect(openingFromUrl('', 'javascript:alert(1)')).toBeNull();
  });

  it('never resolves through the lookup objects’ prototype chain', () => {
    expect(openingFromUrl('#constructor', null)).toBeNull();
    expect(openingFromUrl('', 'toString')).toBeNull();
  });
});

describe('hashFor', () => {
  it('writes one hash per tab, and the bare URL for Today', () => {
    expect(hashFor('today')).toBe('');
    expect(hashFor('money')).toBe('#money');
    expect(hashFor('money', 'spending')).toBe('#money');
    expect(hashFor('money', 'investments')).toBe('#money/investments');
    expect(hashFor('health')).toBe('#health');
    expect(hashFor('journal')).toBe('#journal');
    expect(hashFor('social')).toBe('#social');
    expect(hashFor('career')).toBe('#career');
  });
});

describe('appHref', () => {
  it('links into the app at a tab, with Today named so the hash is never empty', () => {
    expect(appHref('today')).toBe('/active#today');
    expect(appHref('money')).toBe('/active#money');
    expect(appHref('money', 'investments')).toBe('/active#money/investments');
    expect(appHref('social')).toBe('/active#social');
  });

  it('opens the tab it names', () => {
    for (const { id } of TABS) expect(openingFromUrl(new URL(appHref(id), 'https://orbis.test').hash, null)?.tab).toBe(id);
    expect(openingFromUrl(new URL(appHref('money', 'investments'), 'https://orbis.test').hash, null)).toEqual({ tab: 'money', money: 'investments' });
  });
});
