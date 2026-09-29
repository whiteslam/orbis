import { describe, expect, it } from 'vitest';
import { keepCitations, pickSources, rankJournal, terms, weekOf, weeklyRoutines, weeklySpending, weeklySteps } from '@/lib/ask/select';

describe('terms', () => {
  it('keeps content words once', () => {
    expect(terms('How was my spending when I felt stressed? Stressed!')).toEqual(['spending', 'felt', 'stressed']);
  });
});

describe('rankJournal', () => {
  const entries = [
    { date: '2026-09-10', mood: 3, body: 'Quiet day', tags: [] },
    { date: '2026-09-09', mood: 2, body: 'Deadline stress at work', tags: ['work'] },
    { date: '2026-09-08', mood: 4, body: 'Gym and a long walk', tags: ['fitness'] },
  ];

  it('puts matching entries first, then returns them newest first', () => {
    expect(rankJournal('work stress', entries, 2).map((entry) => entry.date)).toEqual(['2026-09-10', '2026-09-09']);
    expect(rankJournal('gym', entries, 1).map((entry) => entry.date)).toEqual(['2026-09-08']);
  });
});

describe('weekOf', () => {
  it('returns the Monday', () => {
    expect(weekOf('2026-09-28')).toBe('2026-09-28');
    expect(weekOf('2026-10-04')).toBe('2026-09-28');
    expect(weekOf('2026-09-27')).toBe('2026-09-21');
  });
});

describe('weeklySpending', () => {
  it('totals the main currency per week and skips others', () => {
    const result = weeklySpending([
      { amount: 100, currency: 'INR', occurredAt: '2026-09-28T05:00:00Z', merchant: 'Cafe', category: null },
      { amount: 250, currency: 'INR', occurredAt: '2026-09-29T05:00:00Z', merchant: 'Grocer', category: 'groceries' },
      { amount: 40, currency: 'INR', occurredAt: '2026-09-20T05:00:00Z', merchant: 'Cafe', category: null },
      { amount: 9, currency: 'USD', occurredAt: '2026-09-28T05:00:00Z', merchant: 'App', category: null },
    ]);
    expect(result.currency).toBe('INR');
    expect(result.weeks).toEqual([
      { week: '2026-09-28', total: 350, count: 2, top: ['groceries', 'Cafe'] },
      { week: '2026-09-14', total: 40, count: 1, top: ['Cafe'] },
    ]);
  });

  it('is empty without transactions', () => {
    expect(weeklySpending([])).toEqual({ currency: null, weeks: [] });
  });
});

describe('weekly steps and routines', () => {
  it('averages steps per week', () => {
    expect(weeklySteps([{ date: '2026-09-28', steps: 1000 }, { date: '2026-09-29', steps: 3000 }])).toEqual([{ week: '2026-09-28', averageSteps: 2000, days: 2 }]);
  });

  it('tallies routine answers per week', () => {
    expect(weeklyRoutines([
      { date: '2026-09-28', title: 'Gym', status: 'done' },
      { date: '2026-09-29', title: 'Gym', status: 'skipped' },
    ])).toEqual([{ week: '2026-09-28', routines: [{ title: 'Gym', done: 1, skipped: 1, other: 0 }] }]);
  });
});

describe('keepCitations', () => {
  it('keeps only supplied ids, once each', () => {
    const supplied = new Map([['journal:2026-09-09', 'Journal, 9 Sept'], ['spending:2026-09-07', 'Spending, week of 7 Sept']]);
    expect(keepCitations(['journal:2026-09-09', 'made:up', 'journal:2026-09-09', 4, 'spending:2026-09-07'], supplied)).toEqual([
      { id: 'journal:2026-09-09', label: 'Journal, 9 Sept' },
      { id: 'spending:2026-09-07', label: 'Spending, week of 7 Sept' },
    ]);
    expect(keepCitations('nope', supplied)).toEqual([]);
  });
});

describe('pickSources', () => {
  it('keeps known sources once, in the order given', () => {
    expect(pickSources(['steps', 'journal', 'steps'])).toEqual(['steps', 'journal']);
  });

  it('drops anything unknown or not a string, and non-arrays', () => {
    expect(pickSources(['journal', 'passwords', 7, null])).toEqual(['journal']);
    expect(pickSources('journal')).toEqual([]);
    expect(pickSources(undefined)).toEqual([]);
  });
});
