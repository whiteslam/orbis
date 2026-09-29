import { describe, expect, it } from 'vitest';
import { recentDays } from '@/lib/focus/widgets';

describe('recentDays', () => {
  it('returns the last six days up to today, filling missing days with zero, scaled to the largest', () => {
    const daily = [{ day: 24, amount: 200 }, { day: 26, amount: 800 }, { day: 29, amount: 400 }];
    expect(recentDays(daily, 29)).toEqual([
      { day: 24, amount: 200, share: 0.25 },
      { day: 25, amount: 0, share: 0 },
      { day: 26, amount: 800, share: 1 },
      { day: 27, amount: 0, share: 0 },
      { day: 28, amount: 0, share: 0 },
      { day: 29, amount: 400, share: 0.5 },
    ]);
  });

  it('never reaches before the 1st of the month', () => {
    expect(recentDays([{ day: 2, amount: 50 }], 3).map((d) => d.day)).toEqual([1, 2, 3]);
  });

  it('is all zero shares when nothing was spent', () => {
    expect(recentDays([], 10).every((d) => d.share === 0)).toBe(true);
  });
});
