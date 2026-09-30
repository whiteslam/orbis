import { test } from 'vitest';
import assert from 'node:assert/strict';
import { routineSlipping, type RoutineEventRow, type RoutineRow } from './routines.ts';

// Wednesday 30 September 2026.
const TODAY = '2026-09-30';
const gym = (extra: Partial<RoutineRow> = {}): RoutineRow => ({
  id: 'r1', title: 'Gym', days: [1, 3, 5], active: true, archivedAt: null, createdDate: '2026-08-01', lastDoneDate: null, ...extra,
});
const done = (localDate: string): RoutineEventRow => ({ routineId: 'r1', localDate, status: 'done' });

test('slipping: the last three scheduled days with no done', () => {
  // Mon 28, Fri 25, Wed 23 were scheduled; nothing done.
  const findings = routineSlipping({ today: TODAY, routines: [gym()], events: [done('2026-09-21')] });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].urgency, 'urgent');
  assert.deepEqual(findings[0].action, { type: 'adjust_routine', routineId: 'r1' });
  assert.equal(findings[0].dedupeKey, 'routine.slipping:r1:since:2026-09-21');
});

test('slipping: one done in the last three is not slipping', () => {
  assert.equal(routineSlipping({ today: TODAY, routines: [gym()], events: [done('2026-09-25')] }).length, 0);
});

test('slipping: skipped still counts as not done', () => {
  const skipped: RoutineEventRow[] = ['2026-09-23', '2026-09-25', '2026-09-28'].map((localDate) => ({ routineId: 'r1', localDate, status: 'skipped' }));
  assert.equal(routineSlipping({ today: TODAY, routines: [gym()], events: skipped }).length, 1);
});

test('slipping: a routine too new to have three scheduled days is left alone', () => {
  assert.equal(routineSlipping({ today: TODAY, routines: [gym({ createdDate: '2026-09-24' })], events: [] }).length, 0);
});

test('slipping: archived and inactive routines are never flagged', () => {
  assert.equal(routineSlipping({ today: TODAY, routines: [gym({ active: false })], events: [] }).length, 0);
  assert.equal(routineSlipping({ today: TODAY, routines: [gym({ archivedAt: '2026-09-01T00:00:00Z' })], events: [] }).length, 0);
});

test('slipping: the key stays the same while it keeps slipping', () => {
  const first = routineSlipping({ today: TODAY, routines: [gym()], events: [] })[0].dedupeKey;
  const later = routineSlipping({ today: '2026-10-02', routines: [gym()], events: [] })[0].dedupeKey;
  assert.equal(first, later);
  assert.equal(first, 'routine.slipping:r1:since:never');
});

test('slipping: the key stays put when the last done is older than the event window', () => {
  const old = gym({ lastDoneDate: '2026-09-10' });
  const first = routineSlipping({ today: TODAY, routines: [old], events: [] })[0].dedupeKey;
  const later = routineSlipping({ today: '2026-10-02', routines: [old], events: [] })[0].dedupeKey;
  assert.equal(first, 'routine.slipping:r1:since:2026-09-10');
  assert.equal(later, first);
});

test('slipping: a 60-character routine name still fits the title limit', () => {
  const [finding] = routineSlipping({ today: TODAY, routines: [gym({ title: 'x'.repeat(60) })], events: [] });
  assert.ok(finding.fallback.title.length <= 80, `title is ${finding.fallback.title.length} characters`);
});
