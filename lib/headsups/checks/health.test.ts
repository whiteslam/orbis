import { test } from 'vitest';
import assert from 'node:assert/strict';
import { addDays } from '../dates.ts';
import { planFinished, stepsDown, type StepDay } from './health.ts';

const TODAY = '2026-09-30';
// 35 days before today: 28 days at `before`, then 7 days at `recent`.
const steps = (before: number, recent: number, gaps = 0): StepDay[] => Array.from({ length: 35 }, (_, index) => {
  const date = addDays(TODAY, -35 + index);
  return { date, steps: index < 28 ? before : recent };
}).filter((_, index) => index < 35 - gaps);

test('steps down: 7-day average at or under 70% of the 28 days before', () => {
  const findings = stepsDown({ today: TODAY, steps: steps(10_000, 7_000) });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].dedupeKey, 'health.steps_down:2026-09-28');
  assert.deepEqual(findings[0].action, { type: 'open_steps' });
});

test('steps down: a near miss does not fire', () => {
  assert.equal(stepsDown({ today: TODAY, steps: steps(10_000, 7_100) }).length, 0);
});

test('steps down: stale imports (under 5 recent days) are not a drop', () => {
  assert.equal(stepsDown({ today: TODAY, steps: steps(10_000, 1_000, 3) }).length, 0);
});

test('steps down: needs 14 days of history before', () => {
  const short = steps(10_000, 1_000).slice(20);
  assert.equal(stepsDown({ today: TODAY, steps: short }).length, 0);
});

const plan = { id: 'p1', title: 'Strength base', createdDate: '2026-08-01', durationWeeks: 8 };

test('plan finished: three days after its last day', () => {
  // 8 weeks from 1 August: the last day is 25 September, so it fires from the 28th.
  assert.equal(planFinished({ today: '2026-09-27', plan }).length, 0);
  const findings = planFinished({ today: '2026-09-28', plan });
  assert.equal(findings.length, 1);
  assert.deepEqual(findings[0].action, { type: 'open_health_plan', planId: 'p1' });
  assert.equal(findings[0].dedupeKey, 'health.plan_finished:p1');
});

test('plan finished: no plan, nothing to say', () => {
  assert.equal(planFinished({ today: TODAY, plan: null }).length, 0);
});

test('plan finished: stops after two weeks, so an old plan is not raised forever', () => {
  // Last day 25 September; the window runs to 9 October.
  assert.equal(planFinished({ today: '2026-10-09', plan }).length, 1);
  assert.equal(planFinished({ today: '2026-10-10', plan }).length, 0);
});

test('plan finished: an 80-character plan title still fits the title limit', () => {
  const [finding] = planFinished({ today: '2026-09-28', plan: { ...plan, title: 'y'.repeat(80) } });
  assert.ok(finding.fallback.title.length <= 80, `title is ${finding.fallback.title.length} characters`);
});
