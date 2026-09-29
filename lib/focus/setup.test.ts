import { describe, expect, it } from 'vitest';
import { setupSteps } from '@/lib/focus/setup';

const done = { aiOn: true, googleConnected: true, routineCount: 2, hasName: true };

describe('setupSteps', () => {
  it('lists every step for a fresh account, in order, each pointing at its Settings section', () => {
    expect(setupSteps({ aiOn: false, googleConnected: false, routineCount: 0, hasName: false }).map((step) => [step.id, step.section])).toEqual([
      ['name', 'you'],
      ['ai', 'ai'],
      ['google', 'connections'],
      ['day', 'day'],
    ]);
  });

  it('drops what is already done', () => {
    expect(setupSteps({ ...done, aiOn: false }).map((step) => step.id)).toEqual(['ai']);
  });

  it('is empty once everything is set up', () => {
    expect(setupSteps(done)).toEqual([]);
  });
});
