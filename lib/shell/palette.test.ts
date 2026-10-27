import { describe, expect, it } from 'vitest';
import { appPalette, rankPalette } from '@/lib/shell/palette';
import { greeting } from '@/lib/shell/desktop';

const CAREER_PAGES = [{ id: 'overview', label: 'Overview' }, { id: 'pipeline', label: 'Pipeline' }];

describe('appPalette', () => {
  const items = appPalette(CAREER_PAGES);

  it('lists every tab, both Money views, every Settings section, the Career pages and Ask Orbis', () => {
    expect(items.filter((item) => item.kind === 'tab').map((item) => item.label)).toEqual(['Today', 'Money', 'Health', 'Journal', 'Social', 'Career']);
    expect(items.filter((item) => item.kind === 'view').map((item) => item.label)).toEqual(['Spending', 'Investments']);
    expect(items.filter((item) => item.kind === 'settings')).toHaveLength(7);
    expect(items.filter((item) => item.kind === 'career').map((item) => item.go)).toEqual([
      { to: 'href', href: '/active/career#/overview' },
      { to: 'href', href: '/active/career#/pipeline' },
    ]);
    expect(items.find((item) => item.kind === 'action')?.go).toEqual({ to: 'ask' });
  });

  it('sends Career to the full panel, and the rest to their own place', () => {
    expect(items.find((item) => item.kind === 'tab' && item.label === 'Career')?.go).toEqual({ to: 'href', href: '/active/career' });
    expect(items.find((item) => item.label === 'Health')?.go).toEqual({ to: 'tab', tab: 'health' });
    expect(items.find((item) => item.label === 'Investments')?.go).toEqual({ to: 'tab', tab: 'money', money: 'investments' });
    expect(items.find((item) => item.label === 'Security')?.go).toEqual({ to: 'settings', section: 'security' });
  });

  it('gives every item its own id', () => {
    expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
  });
});

describe('rankPalette', () => {
  const items = appPalette(CAREER_PAGES);

  it('puts a label that starts with the query first', () => {
    expect(rankPalette(items, 'inv')[0].label).toBe('Investments');
    expect(rankPalette(items, 'HEAL')[0].label).toBe('Health');
  });

  it('needs every word, in the label or the detail', () => {
    const [first] = rankPalette(items, 'settings sec');
    expect(first.label).toBe('Security');
    expect(rankPalette(items, 'pipeline career').map((item) => item.label)).toEqual(['Pipeline']);
  });

  it('returns nothing when nothing matches, and the first items for an empty query', () => {
    expect(rankPalette(items, 'zzzz')).toEqual([]);
    expect(rankPalette(items, '   ', 3).map((item) => item.label)).toEqual(['Today', 'Money', 'Health']);
  });
});

describe('greeting', () => {
  it('follows the part of the day and uses the name when there is one', () => {
    expect(greeting(8, 'Gaurav')).toBe('Good morning, Gaurav');
    expect(greeting(14, null)).toBe('Good afternoon');
    expect(greeting(19, '  ')).toBe('Good evening');
    expect(greeting(23, 'Gaurav')).toBe('Good evening, Gaurav');
    expect(greeting(3, null)).toBe('Hello');
  });
});
