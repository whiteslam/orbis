/**
 * Sarvam speech-to-text and text-to-speech, for Talk to Orbis.
 *
 * No server-only import, so the unit tests can load it directly; the key is
 * passed in by the server action, which is the only caller. The host is fixed
 * here in code, like the AI router's allow-list: nothing configurable decides
 * where a recording is sent.
 */

const HOST = 'https://api.sarvam.ai';
const TIMEOUT_MS = 15_000;
const VOICE = 'priya';

type Options = { apiKey: string; fetcher?: typeof fetch };

async function call(path: string, init: RequestInit, { apiKey, fetcher = fetch }: Options): Promise<Record<string, unknown> | null> {
  try {
    const headers = new Headers(init.headers);
    headers.set('api-subscription-key', apiKey);
    const response = await fetcher(`${HOST}${path}`, { ...init, headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** What was said and the language it was said in, or null when nothing usable came back. */
export async function transcribe(audio: Blob, options: Options): Promise<{ transcript: string; language: string } | null> {
  const form = new FormData();
  form.set('file', audio, 'speech');
  form.set('model', 'saaras:v3');
  form.set('language_code', 'unknown');
  const body = await call('/speech-to-text', { method: 'POST', body: form }, options);
  const transcript = typeof body?.transcript === 'string' ? body.transcript.trim() : '';
  if (!transcript) return null;
  return { transcript, language: typeof body?.language_code === 'string' ? body.language_code : 'en-IN' };
}

/** Base64 WAV of `text` spoken in `language`, or null. */
export async function speak(text: string, language: string, options: Options): Promise<string | null> {
  const words = text.trim();
  if (!words) return null;
  const body = await call(
    '/text-to-speech',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: words.slice(0, 2500), language_code: language, model: 'bulbul:v3', speaker: VOICE, speech_sample_rate: 16000 }),
    },
    options,
  );
  const audios = Array.isArray(body?.audios) ? body.audios : [];
  return typeof audios[0] === 'string' && audios[0] ? audios[0] : null;
}
