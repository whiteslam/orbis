import { describe, expect, it } from 'vitest';
import { appHref, hashFor, openingFromUrl, SETTINGS_SECTIONS, TABS } from '@/lib/shell/tabs';

describe('TABS', () => {
  it('lists the six tabs in order, one name each', () => {
    expect(TABS.map((tab) => tab.id)).toEqual(['today', 'money', 'health', 'journal', 'social', 'career']);
    expect(TABS.map((tab) => tab.label)).toEqual(['Today', 'Money', 'Health', 'Journal', 'Social', 'Career']);
  });
});

describe('SETTINGS_SECTIONS', () => {
  it('lists the seven sections in the order the sheet shows them', () => {
    expect(SETTINGS_SECTIONS.map((section) => section.label)).toEqual(['You', 'Connections', 'AI & privacy', 'Notifications', 'Your day', 'Security', 'Your data']);
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
