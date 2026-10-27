import { test } from 'vitest';
import assert from 'node:assert/strict';
import { composeCareerRow, type CareerToday } from './career.ts';

// 10:00 in India.
const NOW = new Date('2026-10-27T04:30:00Z');
const base = (over: Partial<CareerToday> = {}): CareerToday => ({ interviews: [], offers: [], queue: 0, newMatches: 0, ...over });

test('no row until Career is set up; a quiet one when nothing is new', () => {
  assert.equal(composeCareerRow(null, NOW), null);
  assert.deepEqual(composeCareerRow(base(), NOW), { label: 'Career', value: 'Nothing new', empty: true, target: 'career' });
});

test('an interview in the next 24 hours comes first, the soonest one, in India’s time', () => {
  const row = composeCareerRow(base({
    interviews: [
      { company: 'Bolt', at: '2026-10-28T10:00:00+05:30' },
      { company: 'Acme', at: '2026-10-27T15:30:00+05:30' },
      { company: 'Past', at: '2026-10-27T09:00:00+05:30' },
      { company: 'Unknown', at: null },
    ],
    offers: [{ company: 'Zed' }],
    queue: 3,
  }), NOW);
  assert.equal(row?.value, 'Interview with Acme today, 15:30');
  assert.equal(composeCareerRow(base({ interviews: [{ company: 'Bolt', at: '2026-10-28T09:00:00+05:30' }] }), NOW)?.value, 'Interview with Bolt tomorrow, 09:00');
});

test('an interview more than a day away gives way to an offer', () => {
  const row = composeCareerRow(base({ interviews: [{ company: 'Far', at: '2026-10-30T10:00:00+05:30' }], offers: [{ company: 'Zed' }] }), NOW);
  assert.equal(row?.value, 'Offer from Zed waiting');
  assert.equal(composeCareerRow(base({ offers: [{ company: 'A' }, { company: 'B' }] }), NOW)?.value, '2 offers waiting');
});

test('then drafts waiting, then new matches', () => {
  assert.equal(composeCareerRow(base({ queue: 1, newMatches: 4 }), NOW)?.value, '1 draft waiting for your approval');
  assert.equal(composeCareerRow(base({ queue: 3 }), NOW)?.value, '3 drafts waiting for your approval');
  assert.equal(composeCareerRow(base({ newMatches: 1 }), NOW)?.value, '1 new match');
  assert.deepEqual(composeCareerRow(base({ newMatches: 5 }), NOW), { label: 'Career', value: '5 new matches', empty: false, target: 'career' });
});
