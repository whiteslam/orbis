import { describe, expect, it } from 'vitest';
import { isDue, localDay, nextDayStart, nextSlot } from './schedule';
import type { Schedule } from './types';

const ALL = [1, 2, 3, 4, 5, 6, 7];
const kolkata: Schedule = { postTime: '18:00', days: ALL, timezone: 'Asia/Kolkata', paused: false, holdUntil: null };
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
    expect(isDue(kolkata, after, null)).toBe(true);
    expect(isDue(kolkata, new Date('2026-11-13T12:29:00Z'), null)).toBe(false);
    expect(isDue(kolkata, new Date('2026-11-13T12:30:00Z'), null)).toBe(true);
  });

  it('not due on an unlisted day, when paused, or before hold_until', () => {
    expect(isDue({ ...kolkata, days: [1, 2, 3, 4] }, after, null)).toBe(false);
    expect(isDue({ ...kolkata, paused: true }, after, null)).toBe(false);
    expect(isDue({ ...kolkata, holdUntil: '2026-11-13T13:00:00Z' }, after, null)).toBe(false);
    expect(isDue({ ...kolkata, holdUntil: '2026-11-13T12:31:00Z' }, after, null)).toBe(true);
    expect(isDue({ ...kolkata, holdUntil: '2026-11-13T12:00:00Z' }, after, null)).toBe(true);
  });

  it('not due when the schedule already posted today', () => {
    expect(isDue(kolkata, after, '2026-11-13T12:35:00Z')).toBe(false);
    expect(isDue(kolkata, new Date('2026-11-13T12:40:00Z'), '2026-11-13T12:35:00Z')).toBe(false);
    expect(isDue(kolkata, after, '2026-11-12T12:35:00Z')).toBe(true);
  });

  it('a post at 23:50 yesterday in America/New_York does not block today', () => {
    const ny: Schedule = { ...kolkata, timezone: 'America/New_York' };
    // 23:50 EST on 12 Nov is 04:50Z on 13 Nov: "today" in UTC, but yesterday in New York.
    const now = new Date('2026-11-13T23:30:00Z'); // 18:30 EST on 13 Nov
    expect(isDue(ny, now, '2026-11-13T04:50:00Z')).toBe(true);
    // A post made earlier the same New York day does block it.
    expect(isDue(ny, now, '2026-11-13T22:30:00Z')).toBe(false);
  });

  it('ignores an unreadable lastScheduledAt', () => {
    expect(isDue(kolkata, after, 'nonsense')).toBe(true);
  });
});

describe('nextSlot', () => {
  it('nextSlot skips unlisted days and today once posted', () => {
    const monday = { ...kolkata, days: [1] };
    // Mon 16 Nov 18:00 IST is 12:30Z.
    expect(nextSlot(monday, after, false)?.toISOString()).toBe('2026-11-16T12:30:00.000Z');
    expect(nextSlot({ ...monday, days: [5, 1] }, after, true)?.toISOString()).toBe('2026-11-16T12:30:00.000Z');
  });

  it('gives today’s slot when today is listed, not posted and the time is ahead', () => {
    expect(nextSlot(kolkata, new Date('2026-11-13T05:00:00Z'), false)?.toISOString()).toBe('2026-11-13T12:30:00.000Z');
  });

  it('moves to tomorrow once posted today', () => {
    expect(nextSlot(kolkata, after, true)?.toISOString()).toBe('2026-11-14T12:30:00.000Z');
  });

  it('is null when paused or no day is listed', () => {
    expect(nextSlot({ ...kolkata, paused: true }, after, false)).toBeNull();
    expect(nextSlot({ ...kolkata, days: [] }, after, false)).toBeNull();
  });

  it('waits for hold_until', () => {
    const held = { ...kolkata, holdUntil: '2026-11-13T18:30:00Z' };
    expect(nextSlot(held, after, false)?.toISOString()).toBe('2026-11-14T12:30:00.000Z');
  });

  it('uses the right offset across a daylight saving change', () => {
    const ny: Schedule = { ...kolkata, timezone: 'America/New_York', days: [7] };
    // Sun 1 Nov 2026 is the fall-back day; 18:00 is already EST there, so 23:00Z.
    expect(nextSlot(ny, new Date('2026-10-31T12:00:00Z'), false)?.toISOString()).toBe('2026-11-01T23:00:00.000Z');
  });
});

describe('nextDayStart', () => {
  it('nextDayStart gives local midnight of the next day', () => {
    expect(nextDayStart(after, 'Asia/Kolkata').toISOString()).toBe('2026-11-13T18:30:00.000Z');
    expect(nextDayStart(new Date('2026-11-13T23:30:00Z'), 'America/New_York').toISOString()).toBe('2026-11-14T05:00:00.000Z');
    expect(nextDayStart(new Date('2026-12-31T10:00:00Z'), 'UTC').toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });
});
