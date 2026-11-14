import { describe, expect, it } from 'vitest';
import { autopilotDueOn, autopilotOptions, defaultAutopilot, pickStoryTopic, readAutopilotRow, STORY_IDEAS, type Autopilot } from './autopilot';

const on: Autopilot = { ...defaultAutopilot('Asia/Kolkata'), enabled: true, startTime: '09:00' };
// Sat 14 Nov 2026: 08:59 and 09:00 IST.
const before = new Date('2026-11-14T03:29:00Z');
const at = new Date('2026-11-14T03:30:00Z');

describe('autopilotDueOn', () => {
  it('is due from the start time on the person’s clock, once a day', () => {
    expect(autopilotDueOn(on, before)).toBeNull();
    expect(autopilotDueOn(on, at)).toBe('2026-11-14');
    expect(autopilotDueOn({ ...on, lastRunOn: '2026-11-14' }, at)).toBeNull();
    expect(autopilotDueOn({ ...on, lastRunOn: '2026-11-13' }, at)).toBe('2026-11-14');
  });

  it('is never due while off', () => {
    expect(autopilotDueOn({ ...on, enabled: false }, at)).toBeNull();
  });

  it('uses the local date, not UTC', () => {
    // 20:00 UTC on 14 Nov is already 01:30 on 15 Nov in India.
    expect(autopilotDueOn({ ...on, startTime: '00:00', lastRunOn: '2026-11-14' }, new Date('2026-11-14T20:00:00Z'))).toBe('2026-11-15');
  });
});

describe('STORY_IDEAS and pickStoryTopic', () => {
  it('has 192 different ideas, none longer than a topic may be', () => {
    expect(STORY_IDEAS).toHaveLength(192);
    expect(new Set(STORY_IDEAS).size).toBe(192);
    for (const idea of STORY_IDEAS) expect(idea.length).toBeLessThanOrEqual(300);
  });

  it('skips recent topics and changes with the day', () => {
    const first = pickStoryTopic([], '2026-11-14');
    expect(pickStoryTopic([first], '2026-11-14')).not.toBe(first);
    expect(pickStoryTopic([], '2026-11-15')).not.toBe(first);
    expect(STORY_IDEAS).toContain(first);
  });

  it('falls back to the day’s idea when everything was used recently', () => {
    expect(pickStoryTopic(STORY_IDEAS, '2026-11-14')).toBe(pickStoryTopic([], '2026-11-14'));
  });
});

describe('autopilotOptions and readAutopilotRow', () => {
  it('marks the job as the autopilot’s, with the style’s voice and music', () => {
    expect(autopilotOptions('af_heart', 45)).toEqual({ seconds: 45, voice: 'af_heart', mode: 'voice', music: 'bed', endLine: '', autopilot: true });
  });

  it('reads a stored row and falls back for anything missing', () => {
    expect(readAutopilotRow({ enabled: true, style: 'cozy-tales', start_time: '07:30:00', timezone: 'Europe/London', last_run_on: '2026-11-13' }, 'Asia/Kolkata'))
      .toEqual({ enabled: true, style: 'cozy-tales', startTime: '07:30', timezone: 'Europe/London', lastRunOn: '2026-11-13' });
    expect(readAutopilotRow(null, 'Asia/Kolkata')).toEqual(defaultAutopilot('Asia/Kolkata'));
    expect(readAutopilotRow({ style: 'BAD STYLE', start_time: 'x' }, 'UTC')).toMatchObject({ enabled: false, style: 'cozy-tales', startTime: '09:00' });
  });
});
