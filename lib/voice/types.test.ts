import { describe, expect, it } from 'vitest';
import { clipLength, voiceMime } from '@/lib/voice/types';

describe('voiceMime', () => {
  it('strips codecs and accepts known audio types', () => {
    expect(voiceMime('audio/webm;codecs=opus')).toBe('audio/webm');
    expect(voiceMime('AUDIO/MP4')).toBe('audio/mp4');
  });

  it('rejects anything else', () => {
    expect(voiceMime('video/webm')).toBeNull();
    expect(voiceMime('')).toBeNull();
  });
});

describe('clipLength', () => {
  it('formats minutes and seconds', () => {
    expect(clipLength(42)).toBe('0:42');
    expect(clipLength(245.4)).toBe('4:05');
    expect(clipLength(-3)).toBe('0:00');
  });
});
