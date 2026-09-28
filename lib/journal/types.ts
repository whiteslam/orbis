import type { VoiceNote } from '@/lib/voice/types';

export type JournalEntry = {
  date: string;
  mood: 1 | 2 | 3 | 4 | 5;
  body: string;
  tags: string[];
};

export type JournalSummary = {
  state: 'ready' | 'setup' | 'unavailable';
  entries: JournalEntry[];
  streak: number;
  /** Voice notes for today and the loaded entries' days. Empty before the voice migration. */
  voice?: VoiceNote[];
};

export const MOODS = [
  { value: 1, emoji: '😞', label: 'Rough' },
  { value: 2, emoji: '😕', label: 'Low' },
  { value: 3, emoji: '😐', label: 'Okay' },
  { value: 4, emoji: '🙂', label: 'Good' },
  { value: 5, emoji: '😄', label: 'Great' },
] as const;

export const SUGGESTED_TAGS = ['work', 'family', 'fitness', 'health', 'money', 'friends', 'learning', 'rest'];
