import { describe, expect, it } from 'vitest';
import { defaultAutopilot, type Autopilot } from './autopilot';
import { dailyCap, decideStart, inWindow, pickDestination, shelfDaysLeft, type ShelfCount } from './shelf';

const IST = 'Asia/Kolkata';
// Sat 14 Nov 2026 on the owner's clock (IST = UTC+5:30).
const ist = (time: string, day = '2026-11-14') => new Date(`${day}T${time}:00+05:30`);

describe('inWindow', () => {
  it('wraps past midnight for 23:00–07:00, on the owner’s clock', () => {
    expect(inWindow('23:00', '07:00', ist('23:30'), IST)).toBe(true);
    expect(inWindow('23:00', '07:00', ist('06:59'), IST)).toBe(true);
    expect(inWindow('23:00', '07:00', ist('07:00'), IST)).toBe(false);
    expect(inWindow('23:00', '07:00', ist('22:59'), IST)).toBe(false);
  });

  it('includes the start and leaves out the end within one day', () => {
    expect(inWindow('09:00', '17:00', ist('08:59'), IST)).toBe(false);
    expect(inWindow('09:00', '17:00', ist('09:00'), IST)).toBe(true);
    expect(inWindow('09:00', '17:00', ist('17:00'), IST)).toBe(false);
  });

  it('means any time when start and end are the same', () => {
    for (const time of ['00:00', '06:30', '12:00', '23:59']) expect(inWindow('00:00', '00:00', ist(time), IST)).toBe(true);
  });
});

const youtube = (postsPerDay: number, onShelf: number): ShelfCount => ({ destination: 'youtube', postsPerDay, onShelf });
const instagram = (postsPerDay: number, onShelf: number): ShelfCount => ({ destination: 'instagram', postsPerDay, onShelf });

describe('shelf maths', () => {
  it('counts days left and the daily cap', () => {
    expect(shelfDaysLeft(youtube(2, 5))).toBe(2.5);
    expect(dailyCap([youtube(2, 0)])).toBe(3);
    expect(dailyCap([youtube(2, 0), instagram(1, 0)])).toBe(4);
  });

  it('picks the shelf lowest in days, below target, YouTube on a tie', () => {
    expect(pickDestination([youtube(2, 5), instagram(1, 1)], 3)).toBe('instagram');
    expect(pickDestination([youtube(2, 6), instagram(1, 3)], 3)).toBeNull();
    expect(pickDestination([instagram(1, 1), youtube(2, 2)], 3)).toBe('youtube');
    expect(pickDestination([], 3)).toBeNull();
  });
});

describe('decideStart', () => {
  const on: Autopilot = { ...defaultAutopilot(IST), enabled: true };
  const empty = [youtube(2, 0)];

  it('starts nothing while off, busy, outside the window or with nowhere to post', () => {
    expect(decideStart({ autopilot: { ...on, enabled: false }, now: ist('23:30'), inProgress: 0, shelves: empty })).toBeNull();
    expect(decideStart({ autopilot: on, now: ist('23:30'), inProgress: 1, shelves: empty })).toBeNull();
    expect(decideStart({ autopilot: on, now: ist('12:00'), inProgress: 0, shelves: empty })).toBeNull();
    expect(decideStart({ autopilot: on, now: ist('23:30'), inProgress: 0, shelves: [] })).toBeNull();
  });

  it('starts one for the lowest shelf, with the local day and the day’s cap', () => {
    expect(decideStart({ autopilot: on, now: ist('23:30'), inProgress: 0, shelves: empty }))
      .toEqual({ today: '2026-11-14', destination: 'youtube', cap: 3 });
    expect(decideStart({ autopilot: on, now: ist('00:30', '2026-11-15'), inProgress: 0, shelves: empty })?.today).toBe('2026-11-15');
  });
});
