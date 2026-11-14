import { describe, expect, it } from 'vitest';
import { shortsHealth, type HealthInput, type HealthLine } from './health';

// Sat 14 Nov 2026, 12:00 IST.
const now = new Date('2026-11-14T06:30:00Z');
const base: HealthInput = {
  now,
  worker: { presence: 'idle', note: null, lastSeen: now.toISOString() },
  youtube: { state: 'connected', onShelf: 5, postsPerDay: 2, nextPost: new Date('2026-11-14T13:30:00Z'), paused: false, holdUntil: null, timeZone: 'Asia/Kolkata' },
  failedBuilds24h: 0,
  failedPosts24h: 0,
};
const health = (patch: Partial<HealthInput> = {}, youtube: Partial<HealthInput['youtube']> = {}) =>
  shortsHealth({ ...base, ...patch, youtube: { ...base.youtube, ...youtube } });
const line = (lines: HealthLine[], key: HealthLine['key']) => lines.find((one) => one.key === key)!;

describe('shortsHealth', () => {
  it('always gives shelf, next, pc, accounts and problems, in that order', () => {
    expect(health().map((one) => one.key)).toEqual(['shelf', 'next', 'pc', 'accounts', 'problems']);
    expect(health().map((one) => one.label)).toEqual(['Shelf', 'Next post', 'PC', 'Accounts', 'Problems']);
  });

  it('counts the shelf in half days', () => {
    expect(line(health(), 'shelf')).toMatchObject({ text: 'YouTube 5 · about 2½ days', tone: 'ok' });
    expect(line(health({}, { onShelf: 1 }), 'shelf')).toMatchObject({ text: 'YouTube 1 · about ½ day', tone: 'warn' });
    expect(line(health({}, { onShelf: 2 }), 'shelf')).toMatchObject({ text: 'YouTube 2 · about 1 day', tone: 'ok' });
    expect(line(health({}, { onShelf: 6, postsPerDay: 1 }), 'shelf').text).toBe('YouTube 6 · about 6 days');
    expect(line(health({}, { onShelf: 0 }), 'shelf')).toMatchObject({ text: 'YouTube 0 · none ready', tone: 'warn' });
  });

  it('says when the next post goes, on the schedule’s clock', () => {
    expect(line(health(), 'next').text).toBe('YouTube Today 7:00 pm');
    expect(line(health({}, { nextPost: new Date('2026-11-15T03:30:00Z') }), 'next').text).toBe('YouTube Tomorrow 9:00 am');
    expect(line(health({}, { nextPost: new Date('2026-11-20T13:30:00Z') }), 'next').text).toBe('YouTube Fri 7:00 pm');
    expect(line(health({}, { paused: true }), 'next').text).toBe('Paused');
  });

  it('says the next post won’t go out while YouTube isn’t connected', () => {
    expect(line(health({}, { state: 'not_connected' }), 'next'))
      .toMatchObject({ text: 'YouTube Today 7:00 pm · won’t post until YouTube is connected', tone: 'bad' });
    expect(line(health({}, { state: 'reconnect' }), 'next'))
      .toMatchObject({ text: 'YouTube Today 7:00 pm · won’t post until YouTube is connected', tone: 'bad' });
    expect(line(health(), 'next').tone).toBe('ok');
    expect(line(health({}, { nextPost: null }), 'next').text).toBe('—');
  });

  it('says whether the PC is there', () => {
    expect(line(health(), 'pc')).toMatchObject({ text: 'Online', tone: 'ok' });
    expect(line(health({ worker: { presence: 'busy', note: 'Building: a baby owl', lastSeen: null } }), 'pc').text).toBe('Online · Building: a baby owl');
    expect(line(health({ worker: { presence: 'offline', note: null, lastSeen: '2026-11-14T00:42:00Z' } }), 'pc'))
      .toMatchObject({ text: 'Offline since 6:12 am', tone: 'bad' });
    expect(line(health({ worker: { presence: 'none', note: null, lastSeen: null } }), 'pc')).toMatchObject({ text: 'Not set up', tone: 'warn' });
  });

  it('says whether YouTube is connected', () => {
    expect(line(health(), 'accounts')).toMatchObject({ text: 'YouTube connected', tone: 'ok' });
    expect(line(health({}, { state: 'reconnect' }), 'accounts')).toMatchObject({ text: 'YouTube needs connecting again', tone: 'bad' });
    expect(line(health({}, { state: 'not_connected' }), 'accounts')).toMatchObject({ text: 'YouTube not connected', tone: 'warn' });
    expect(line(health({}, { state: 'not_set_up' }), 'accounts')).toMatchObject({ text: 'YouTube not connected', tone: 'warn' });
  });

  it('lists the last day’s problems', () => {
    expect(line(health(), 'problems')).toMatchObject({ text: 'None in the last 24 h', tone: 'ok' });
    expect(line(health({ failedBuilds24h: 2 }, { holdUntil: '2026-11-14T18:30:00Z' }), 'problems'))
      .toMatchObject({ text: '2 builds failed · YouTube daily limit hit', tone: 'warn' });
    expect(line(health({ failedBuilds24h: 1, failedPosts24h: 1 }, { holdUntil: '2026-11-14T00:00:00Z' }), 'problems').text)
      .toBe('1 build failed · 1 post failed');
  });
});
