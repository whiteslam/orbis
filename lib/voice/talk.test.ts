import { describe, expect, it } from 'vitest';
import { languageName, talkAudioProblem, trimHistory, ttsLanguage, TALK_MAX_BYTES, TALK_MAX_TURNS } from '@/lib/voice/talk';

describe('ttsLanguage', () => {
  it('keeps a language Orbis can speak', () => {
    expect(ttsLanguage('ta-IN')).toBe('ta-IN');
    expect(ttsLanguage('hi-IN')).toBe('hi-IN');
  });

  it('falls back to Indian English for anything it cannot speak', () => {
    expect(ttsLanguage('ur-IN')).toBe('en-IN');
    expect(ttsLanguage(undefined)).toBe('en-IN');
    expect(ttsLanguage('<script>')).toBe('en-IN');
  });
});

describe('languageName', () => {
  it('names the language for the prompt', () => {
    expect(languageName('mr-IN')).toBe('Marathi');
    expect(languageName('en-IN')).toBe('English');
  });
});

describe('talkAudioProblem', () => {
  it('accepts a short recording in a recorder format', () => {
    expect(talkAudioProblem({ type: 'audio/webm;codecs=opus', size: 120_000 })).toBeNull();
    expect(talkAudioProblem({ type: 'audio/mp4', size: 90_000 })).toBeNull();
  });

  it('refuses empty, oversized or non-audio uploads', () => {
    expect(talkAudioProblem({ type: 'audio/webm', size: 0 })).toMatch(/didn’t catch/i);
    expect(talkAudioProblem({ type: 'audio/webm', size: TALK_MAX_BYTES + 1 })).toMatch(/shorter/i);
    expect(talkAudioProblem({ type: 'text/html', size: 500 })).toMatch(/format/i);
  });
});

describe('trimHistory', () => {
  it('keeps only well-formed turns, the most recent last', () => {
    const turns = Array.from({ length: TALK_MAX_TURNS + 3 }, (_, index) => ({ question: `q${index}`, answer: `a${index}` }));
    const kept = trimHistory([null, 'x', { question: 1 }, ...turns]);
    expect(kept).toHaveLength(TALK_MAX_TURNS);
    expect(kept.at(-1)).toEqual({ question: `q${TALK_MAX_TURNS + 2}`, answer: `a${TALK_MAX_TURNS + 2}` });
  });

  it('clips long turns so the client cannot flood the prompt', () => {
    const [turn] = trimHistory([{ question: 'q'.repeat(2000), answer: 'a'.repeat(5000) }]);
    expect(turn.question.length).toBe(300);
    expect(turn.answer.length).toBe(600);
  });

  it('returns nothing for a non-array', () => {
    expect(trimHistory('turns')).toEqual([]);
  });
});
