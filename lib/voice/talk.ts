/**
 * Talk to Orbis: the rules for one spoken turn. Client-safe and pure.
 *
 * Speech is heard in any of the Indian languages Sarvam detects, but spoken
 * back only in the ones it can voice; anything else is answered in Indian
 * English rather than in a voice that mangles the language.
 */
import { voiceMime } from '@/lib/voice/types';

/** Longest a single spoken question may run; the recorder stops itself here. */
export const TALK_MAX_SECONDS = 30;
/** 30 s of opus is well under this; the cap is for a misbehaving client. */
export const TALK_MAX_BYTES = 2 * 1024 * 1024;
/** Earlier turns sent with a question, so "and last month?" has something to refer to. */
export const TALK_MAX_TURNS = 6;

const SPOKEN: Record<string, string> = {
  'en-IN': 'English',
  'hi-IN': 'Hindi',
  'bn-IN': 'Bengali',
  'gu-IN': 'Gujarati',
  'kn-IN': 'Kannada',
  'ml-IN': 'Malayalam',
  'mr-IN': 'Marathi',
  'od-IN': 'Odia',
  'pa-IN': 'Punjabi',
  'ta-IN': 'Tamil',
  'te-IN': 'Telugu',
};

export type TalkTurn = { question: string; answer: string };

/** The language Orbis answers in: the one heard, when it can speak it. */
export function ttsLanguage(heard: unknown): string {
  return typeof heard === 'string' && heard in SPOKEN ? heard : 'en-IN';
}

/** "mr-IN" → "Marathi", for telling the model which language to write in. */
export function languageName(code: string): string {
  return SPOKEN[ttsLanguage(code)];
}

/** Why a recording can't be sent, or null when it can. */
export function talkAudioProblem(file: { type: string; size: number }): string | null {
  if (!voiceMime(file.type)) return 'That recording format isn’t supported.';
  if (file.size <= 0) return 'Orbis didn’t catch that. Try again.';
  if (file.size > TALK_MAX_BYTES) return `Keep it shorter: up to ${TALK_MAX_SECONDS} seconds at a time.`;
  return null;
}

/**
 * Earlier turns as the client sent them, checked and cut down: they arrive from
 * the browser, so they are untrusted and must not be able to flood the prompt.
 */
export function trimHistory(value: unknown): TalkTurn[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((turn): turn is TalkTurn => !!turn && typeof turn === 'object' && typeof turn.question === 'string' && typeof turn.answer === 'string')
    .slice(-TALK_MAX_TURNS)
    .map((turn) => ({ question: turn.question.slice(0, 300), answer: turn.answer.slice(0, 600) }));
}
