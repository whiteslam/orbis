import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dueSlots, localClock, type SlotPreferences } from './schedule.ts';

const prefs = (overrides: Partial<SlotPreferences> = {}): SlotPreferences => ({
  enabled: true,
  timezone: 'Asia/Kolkata',
  slots: {
    morning: { enabled: true, time: '06:30' },
    lunch: { enabled: true, time: '14:00' },
    evening: { enabled: true, time: '19:00' },
    night: { enabled: true, time: '22:00' },
  },
  ...overrides,
});

// 08:30 UTC = 14:00 IST.
const ist = (hhmm: string, date = '2026-09-24') => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)), h, m) - 330 * 60_000);
};

test('localClock converts to the user timezone', () => {
  assert.deepEqual(localClock(ist('14:05'), 'Asia/Kolkata'), { date: '2026-09-24', minutes: 14 * 60 + 5 });
  assert.equal(localClock(ist('00:10', '2026-09-25'), 'Asia/Kolkata').date, '2026-09-25');
});

test('a slot is due from its time until 45 minutes later', () => {
  assert.deepEqual(dueSlots(prefs(), ist('13:59')).slots, []);
  assert.deepEqual(dueSlots(prefs(), ist('14:00')).slots, ['lunch']);
  assert.deepEqual(dueSlots(prefs(), ist('14:44')).slots, ['lunch']);
  assert.deepEqual(dueSlots(prefs(), ist('14:45')).slots, []);
});

test('disabled switches and invalid times are never due', () => {
  assert.deepEqual(dueSlots(prefs({ enabled: false }), ist('14:10')).slots, []);
  const lunchOff = prefs();
  lunchOff.slots.lunch = { enabled: false, time: '14:00' };
  assert.deepEqual(dueSlots(lunchOff, ist('14:10')).slots, []);
  const broken = prefs();
  broken.slots.lunch = { enabled: true, time: 'soon' };
  assert.deepEqual(dueSlots(broken, ist('14:10')).slots, []);
});

test('database time values with seconds are accepted, and the local date is returned', () => {
  const withSeconds = prefs();
  withSeconds.slots.night = { enabled: true, time: '22:00:00' };
  assert.deepEqual(dueSlots(withSeconds, ist('22:15')), { date: '2026-09-24', slots: ['night'] });
});

test('an unknown timezone falls back to India time instead of throwing', () => {
  assert.deepEqual(dueSlots(prefs({ timezone: 'Mars/Olympus' }), ist('14:10')).slots, ['lunch']);
});
