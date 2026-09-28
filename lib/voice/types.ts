/**
 * Voice notes on journal days. Client-safe and pure.
 *
 * A clip is capped by length and by size; the bucket enforces the size and the
 * type again, so these are the friendly first line, not the only one.
 */

export type VoiceNote = {
  id: string;
  date: string;
  durationSeconds: number;
  createdAt: string;
};

export const VOICE_MAX_SECONDS = 300;
export const VOICE_MAX_BYTES = 10 * 1024 * 1024;
export const VOICE_MAX_PER_DAY = 5;

/** Audio types the bucket accepts, with the file extension each is stored under. */
export const VOICE_TYPES: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/aac': 'aac',
  'audio/wav': 'wav',
};

/** "audio/webm;codecs=opus" → "audio/webm", or null when the type is not accepted. */
export function voiceMime(type: string): string | null {
  const base = type.split(';')[0].trim().toLowerCase();
  return base in VOICE_TYPES ? base : null;
}

/** Recording formats to try, best first. Safari records mp4; everything else webm or ogg. */
export const RECORDER_PREFERENCES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];

/** "0:42", "4:05". */
export function clipLength(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}
