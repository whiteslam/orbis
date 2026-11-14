import { describe, expect, it } from 'vitest';
import { dayStart, isDue, localDay, nextDayStart, nextSlot, slotMinutes } from './schedule';
import type { Schedule } from './types';

const ALL = [1, 2, 3, 4, 5, 6, 7];
const kolkata: Schedule = { postTimes: ['18:00'], days: ALL, timezone: 'Asia/Kolkata', paused: false, holdUntil: null };
// Friday 13 Nov 2026, 18:01 IST.
const after = new Date('2026-11-13T12:31:00Z');

describe('localDay', () => {
  it('gives the local date, ISO weekday and minutes since midnight', () => {
    expect(localDay(after, 'Asia/Kolkata')).toEqual({ date: '2026-11-13', isoDay: 5, minutes: 18 * 60 + 1 });
    expect(localDay(new Date('2026-11-15T20:00:00Z'), 'Asia/Kolkata')).toMatchObject({ date: '2026-11-16', isoDay: 1, minutes: 90 });
    expect(localDay(new Date('2026-11-15T12:00:00Z'), 'UTC').isoDay).toBe(7);
  });
});

describe('isDue', () => {
  it('due after post time on a listed day', () => {
    expect(isDue(kolkata, after, 0)).toBe(true);
    expect(isDue(kolkata, new Date('2026-11-13T12:29:00Z'), 0)).toBe(false);
    expect(isDue(kolkata, new Date('2026-11-13T12:30:00Z'), 0)).toBe(true);
  });

  it('not due on an unlisted day, when paused, or before hold_until', () => {
    expect(isDue({ ...kolkata, days: [1, 2, 3, 4] }, after, 0)).toBe(false);
    expect(isDue({ ...kolkata, paused: true }, after, 0)).toBe(false);
    expect(isDue({ ...kolkata, holdUntil: '2026-11-13T13:00:00Z' }, after, 0)).toBe(false);
    expect(isDue({ ...kolkata, holdUntil: '2026-11-13T12:31:00Z' }, after, 0)).toBe(true);
    expect(isDue({ ...kolkata, holdUntil: '2026-11-13T12:00:00Z' }, after, 0)).toBe(true);
  });

  it('not due when the schedule already posted today', () => {
    expect(isDue(kolkata, after, 1)).toBe(false);
    expect(isDue(kolkata, new Date('2026-11-13T12:40:00Z'), 1)).toBe(false);
  });

  it('with several times, each one posts once and a missed one is caught up once', () => {
    const three: Schedule = { ...kolkata, postTimes: ['09:00', '13:00', '18:00'] };
    const at = (iso: string) => new Date(iso);
    // 08:59 IST: nothing yet.
    expect(isDue(three, at('2026-11-13T03:29:00Z'), 0)).toBe(false);
    // 09:00 IST: the first time.
    expect(isDue(three, at('2026-11-13T03:30:00Z'), 0)).toBe(true);
    expect(isDue(three, at('2026-11-13T03:40:00Z'), 1)).toBe(false);
    // 13:05 IST, one posted: the second is due; after it, nothing until 18:00.
    expect(isDue(three, at('2026-11-13T07:35:00Z'), 1)).toBe(true);
    expect(isDue(three, at('2026-11-13T07:45:00Z'), 2)).toBe(false);
    // 18:01 IST with only one posted (13:00 missed): due, and once 18:00 is covered too the day is full.
    expect(isDue(three, after, 1)).toBe(true);
    expect(isDue(three, after, 2)).toBe(true);
    expect(isDue(three, after, 3)).toBe(false);
  });

  it('a day never posts more than it has times', () => {
    const two: Schedule = { ...kolkata, postTimes: ['10:00', '18:00'] };
    expect(isDue(two, new Date('2026-11-13T18:00:00Z'), 2)).toBe(false);
  });
});

describe('slotMinutes and dayStart', () => {
  it('sorts the times and drops repeats', () => {
    expect(slotMinutes({ postTimes: ['18:00', '09:30', '18:00'] })).toEqual([570, 1080]);
  });

  it('gives local midnight of today', () => {
    expect(dayStart(after, 'Asia/Kolkata').toISOString()).toBe('2026-11-12T18:30:00.000Z');
    expect(dayStart(new Date('2026-11-13T23:30:00Z'), 'America/New_York').toISOString()).toBe('2026-11-13T05:00:00.000Z');
  });
});

describe('nextSlot', () => {
  it('nextSlot skips unlisted days and today once posted', () => {
    const monday = { ...kolkata, days: [1] };
    // Mon 16 Nov 18:00 IST is 12:30Z.
    expect(nextSlot(monday, after, 0)?.toISOString()).toBe('2026-11-16T12:30:00.000Z');
    expect(nextSlot({ ...monday, days: [5, 1] }, after, 1)?.toISOString()).toBe('2026-11-16T12:30:00.000Z');
  });

  it('gives today’s slot when today is listed, not posted and the time is ahead', () => {
    expect(nextSlot(kolkata, new Date('2026-11-13T05:00:00Z'), 0)?.toISOString()).toBe('2026-11-13T12:30:00.000Z');
  });

  it('moves to tomorrow once posted today', () => {
    expect(nextSlot(kolkata, after, 1)?.toISOString()).toBe('2026-11-14T12:30:00.000Z');
  });

  it('with several times, gives the next unused one today, then tomorrow’s first', () => {
    const two: Schedule = { ...kolkata, postTimes: ['18:00', '09:00'] };
    // 10:30 IST, one posted (09:00): 18:00 today.
    expect(nextSlot(two, new Date('2026-11-13T05:00:00Z'), 1)?.toISOString()).toBe('2026-11-13T12:30:00.000Z');
    // 10:30 IST, none posted: 09:00 was missed, so it is due now.
    expect(nextSlot(two, new Date('2026-11-13T05:00:00Z'), 0)?.toISOString()).toBe('2026-11-13T03:30:00.000Z');
    // Both used: tomorrow 09:00 IST.
    expect(nextSlot(two, after, 2)?.toISOString()).toBe('2026-11-14T03:30:00.000Z');
  });

  it('is null when paused or no day is listed', () => {
    expect(nextSlot({ ...kolkata, paused: true }, after, 0)).toBeNull();
    expect(nextSlot({ ...kolkata, days: [] }, after, 0)).toBeNull();
  });

  it('waits for hold_until', () => {
    const held = { ...kolkata, holdUntil: '2026-11-13T18:30:00Z' };
    expect(nextSlot(held, after, 0)?.toISOString()).toBe('2026-11-14T12:30:00.000Z');
  });

  it('uses the right offset across a daylight saving change', () => {
    const ny: Schedule = { ...kolkata, timezone: 'America/New_York', days: [7] };
    // Sun 1 Nov 2026 is the fall-back day; 18:00 is already EST there, so 23:00Z.
    expect(nextSlot(ny, new Date('2026-10-31T12:00:00Z'), 0)?.toISOString()).toBe('2026-11-01T23:00:00.000Z');
  });
});

describe('nextDayStart', () => {
  it('nextDayStart gives local midnight of the next day', () => {
    expect(nextDayStart(after, 'Asia/Kolkata').toISOString()).toBe('2026-11-13T18:30:00.000Z');
    expect(nextDayStart(new Date('2026-11-13T23:30:00Z'), 'America/New_York').toISOString()).toBe('2026-11-14T05:00:00.000Z');
    expect(nextDayStart(new Date('2026-12-31T10:00:00Z'), 'UTC').toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });
});
