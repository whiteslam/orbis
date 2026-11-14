import { describe, expect, it } from 'vitest';
import { autopilotOptions, defaultAutopilot, pickStoryTopic, readAutopilotInput, readAutopilotRow, STORY_IDEAS } from './autopilot';

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

describe('autopilotOptions, readAutopilotRow and readAutopilotInput', () => {
  it('marks the job as the autopilot’s, with the style’s voice, music and where it posts', () => {
    expect(autopilotOptions('af_heart', 45, 'youtube')).toEqual({
      seconds: 45, voice: 'af_heart', mode: 'voice', music: 'bed', endLine: '', autopilot: true, destination: 'youtube',
    });
    expect(autopilotOptions('am_michael', 45, 'youtube').destination).toBe('youtube');
  });

  it('starts off, building 23:00–07:00, 3 days ready, posting to YouTube', () => {
    expect(defaultAutopilot('Asia/Kolkata')).toEqual({
      enabled: false, style: 'cozy-tales', windowStart: '23:00', windowEnd: '07:00', shelfDays: 3, destinations: ['youtube'],
      timezone: 'Asia/Kolkata', startedOn: null, startedCount: 0,
    });
  });

  it('reads every stored column', () => {
    expect(readAutopilotRow({
      enabled: true, style: 'cozy-tales', start_time: '22:30:00', window_end: '06:00:00', shelf_days: 5,
      destinations: ['youtube', 'instagram'], timezone: 'Europe/London', started_on: '2026-11-13', started_count: 2,
    }, 'Asia/Kolkata')).toEqual({
      enabled: true, style: 'cozy-tales', windowStart: '22:30', windowEnd: '06:00', shelfDays: 5,
      destinations: ['youtube', 'instagram'], timezone: 'Europe/London', startedOn: '2026-11-13', startedCount: 2,
    });
  });

  it('falls back for anything missing or wrong', () => {
    expect(readAutopilotRow(null, 'Asia/Kolkata')).toEqual(defaultAutopilot('Asia/Kolkata'));
    expect(readAutopilotRow({ style: 'BAD STYLE', start_time: 'x', window_end: 7, shelf_days: 9, destinations: ['tiktok'], started_count: -1 }, 'UTC'))
      .toMatchObject({ enabled: false, style: 'cozy-tales', windowStart: '23:00', windowEnd: '07:00', shelfDays: 3, destinations: ['youtube'], startedCount: 0 });
  });

  it('accepts a good form and refuses each bad field', () => {
    const good = { enabled: true, windowStart: '23:00', windowEnd: '07:00', shelfDays: 3, destinations: ['youtube'] };
    expect(readAutopilotInput(good)).toEqual(good);
    for (const bad of [
      { windowEnd: '24:00' }, { windowStart: '9:00' }, { shelfDays: 8 }, { shelfDays: 0 }, { shelfDays: 2.5 },
      { destinations: [] }, { destinations: ['youtube', 'youtube'] }, { destinations: ['tiktok'] }, { enabled: 'yes' },
    ]) expect(readAutopilotInput({ ...good, ...bad })).toBeNull();
    expect(readAutopilotInput(null)).toBeNull();
  });
});
