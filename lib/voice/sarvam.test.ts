import { describe, expect, it } from 'vitest';
import { speak, transcribe } from '@/lib/voice/sarvam';

type Call = { url: string; init: RequestInit };

function fakeFetch(status: number, body: unknown) {
  const calls: Call[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { calls, fetcher };
}

const audio = new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm' });

describe('transcribe', () => {
  it('sends the audio to Sarvam with the key and auto language detection', async () => {
    const { calls, fetcher } = fakeFetch(200, { transcript: ' नमस्ते, आज कितना खर्च हुआ? ', language_code: 'hi-IN' });
    const result = await transcribe(audio, { apiKey: 'sk_test', fetcher });

    expect(result).toEqual({ transcript: 'नमस्ते, आज कितना खर्च हुआ?', language: 'hi-IN' });
    expect(calls[0].url).toBe('https://api.sarvam.ai/speech-to-text');
    expect(new Headers(calls[0].init.headers).get('api-subscription-key')).toBe('sk_test');
    const form = calls[0].init.body as FormData;
    expect(form.get('language_code')).toBe('unknown');
    expect(form.get('model')).toBe('saaras:v3');
    expect(form.get('file')).toBeInstanceOf(Blob);
  });

  it('returns null when Sarvam fails or hears nothing', async () => {
    expect(await transcribe(audio, { apiKey: 'k', fetcher: fakeFetch(500, {}).fetcher })).toBeNull();
    expect(await transcribe(audio, { apiKey: 'k', fetcher: fakeFetch(200, { transcript: '  ' }).fetcher })).toBeNull();
  });
});

describe('speak', () => {
  it('asks for speech in the given language and returns the audio', async () => {
    const { calls, fetcher } = fakeFetch(200, { audios: ['UklGRg=='] });
    expect(await speak('Aaj ₹420 kharch hua.', 'hi-IN', { apiKey: 'sk_test', fetcher })).toBe('UklGRg==');

    expect(calls[0].url).toBe('https://api.sarvam.ai/text-to-speech');
    const body = JSON.parse(String(calls[0].init.body));
    expect(body).toMatchObject({ text: 'Aaj ₹420 kharch hua.', language_code: 'hi-IN', model: 'bulbul:v3', speech_sample_rate: 16000 });
    expect(typeof body.speaker).toBe('string');
  });

  it('returns null when Sarvam fails or sends no audio', async () => {
    expect(await speak('hi', 'en-IN', { apiKey: 'k', fetcher: fakeFetch(429, {}).fetcher })).toBeNull();
    expect(await speak('hi', 'en-IN', { apiKey: 'k', fetcher: fakeFetch(200, { audios: [] }).fetcher })).toBeNull();
  });

  it('never sends an empty text', async () => {
    const { calls, fetcher } = fakeFetch(200, { audios: ['x'] });
    expect(await speak('   ', 'en-IN', { apiKey: 'k', fetcher })).toBeNull();
    expect(calls).toHaveLength(0);
  });
});
