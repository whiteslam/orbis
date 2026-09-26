import { test } from 'node:test';
import assert from 'node:assert/strict';
import { currentRoutine, localParts, missedRoutines, relativeWhen, routinesToday, settledToday } from './today.ts';
import type { Routine, RoutineEvent, RoutinesSummary } from './types.ts';

// Thursday 24 September 2026. IST is UTC+5:30, so 13:30Z is 7:00 pm.
const at = (hhmm: string) => new Date(`2026-09-24T${hhmm}:00Z`);
const SEVEN_PM = at('13:30');

const routine = (over: Partial<Routine> = {}): Routine => ({
  id: 'gym', title: 'Gym', kind: 'workout', atTime: '19:00', days: [0, 1, 2, 3, 4, 5, 6], active: true, ...over,
});

const summary = (routines: Routine[], events: RoutineEvent[] = []): RoutinesSummary => ({ state: 'ready', routines, events });

const event = (over: Partial<RoutineEvent> = {}): RoutineEvent => ({
  id: 'e1', routineId: 'gym', title: 'Gym', localDate: '2026-09-24', status: 'done', note: null, ...over,
});

test('the local day is read in the user’s timezone, not the server’s', () => {
  // 20:00 UTC on the 24th is already 1:30 am on the 25th in Kolkata.
  assert.equal(localParts(new Date('2026-09-24T20:00:00Z')).date, '2026-09-25');
  assert.equal(localParts(SEVEN_PM).date, '2026-09-24');
  assert.equal(localParts(SEVEN_PM).minutes, 19 * 60);
  assert.equal(localParts(SEVEN_PM).weekday, 4, 'Thursday');
});

test('only today’s routines are listed, in clock order', () => {
  const today = routinesToday(summary([
    routine({ id: 'gym', atTime: '19:00' }),
    routine({ id: 'breakfast', title: 'Breakfast', kind: 'meal', atTime: '08:00' }),
    routine({ id: 'sunday', title: 'Long run', atTime: '07:00', days: [0] }),
    routine({ id: 'off', title: 'Paused', atTime: '09:00', active: false }),
  ]), SEVEN_PM);
  assert.deepEqual(today.map((item) => item.routine.id), ['breakfast', 'gym'], 'Sunday-only and paused drop out');
  assert.equal(today[1].minutesAway, 0, 'the 7 pm session is due now');
  assert.equal(today[0].minutesAway, -660);
});

test('a routine is current from 45 minutes before until 90 after', () => {
  const soon = currentRoutine(routinesToday(summary([routine()]), at('12:50')));
  assert.equal(soon?.routine.id, 'gym', '6:20 pm is inside the lead-in');
  assert.equal(currentRoutine(routinesToday(summary([routine()]), at('12:30')))?.minutesAway, 60, 'earlier, it is merely next');

  assert.ok(currentRoutine(routinesToday(summary([routine()]), at('14:50'))), '8:20 pm is still inside the grace');
  assert.equal(currentRoutine(routinesToday(summary([routine()]), at('15:30'))), null, 'past 9 pm it is missed, not current');
});

test('an answered routine stops being the headline', () => {
  const answered = currentRoutine(routinesToday(summary([routine()], [event()]), SEVEN_PM));
  assert.equal(answered, null, 'the brief moves on rather than congratulating you');

  // With something else still open, that becomes the headline instead.
  const next = currentRoutine(routinesToday(
    summary([routine(), routine({ id: 'dinner', title: 'Dinner', kind: 'meal', atTime: '21:00' })], [event()]),
    SEVEN_PM,
  ));
  assert.equal(next?.routine.id, 'dinner');
});

test('the nearest routine wins when two are in play', () => {
  const pair = [routine({ id: 'gym', atTime: '19:00' }), routine({ id: 'dinner', title: 'Dinner', kind: 'meal', atTime: '19:20' })];

  // 7:20 pm: dinner is due now, the gym was twenty minutes ago.
  assert.equal(currentRoutine(routinesToday(summary(pair), at('13:50')))?.routine.id, 'dinner');
  // 6:55 pm: the gym is imminent, dinner is still a way off.
  assert.equal(currentRoutine(routinesToday(summary(pair), at('13:25')))?.routine.id, 'gym');
  // 7:10 pm is exactly between them, so the one already under way wins.
  assert.equal(currentRoutine(routinesToday(summary(pair), at('13:40')))?.routine.id, 'gym');
});

test('routines that went by unanswered are reported separately', () => {
  const today = routinesToday(summary([
    routine({ id: 'breakfast', title: 'Breakfast', kind: 'meal', atTime: '08:00' }),
    routine({ id: 'lunch', title: 'Lunch', kind: 'meal', atTime: '14:00' }),
    routine({ id: 'gym', atTime: '19:00' }),
  ], [event({ id: 'e2', routineId: 'breakfast', title: 'Breakfast' })]), SEVEN_PM);

  assert.deepEqual(missedRoutines(today).map((item) => item.routine.id), ['lunch'], 'answered ones are not missed');
  assert.deepEqual(settledToday(today), { done: 1, total: 3, answered: 1 });
});

test('a schedule that is not set up yet produces nothing to say', () => {
  assert.deepEqual(routinesToday({ state: 'setup', routines: [], events: [] }, SEVEN_PM), []);
  assert.equal(currentRoutine([]), null);
});

test('the gap is said the way a person would say it', () => {
  assert.equal(relativeWhen(0), 'now');
  assert.equal(relativeWhen(-8), 'now');
  assert.equal(relativeWhen(25), 'in 25 minutes');
  assert.equal(relativeWhen(120), 'in about 2 hours');
  assert.equal(relativeWhen(-40), '40 minutes ago');
  assert.equal(relativeWhen(-60), '1 hour ago');
});
