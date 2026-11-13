import { test } from 'vitest';
import assert from 'node:assert/strict';
import { DEFAULT_IMAGE_MODEL, DEFAULT_OPENROUTER_IMAGE_MODEL, callTimeout, generatePromoImage, geminiImageRequest, openRouterImageRequest, readGeminiImage, readOpenRouterImage } from './promo-image.ts';

const png = (text = 'png') => ({ candidates: [{ content: { parts: [{ text: 'x' }, { inlineData: { mimeType: 'image/png', data: Buffer.from(text).toString('base64') } }] } }] });

test('the request asks for one square image only', () => {
  const body = geminiImageRequest('p') as { contents: Array<{ parts: Array<{ text: string }> }>; generationConfig: { responseModalities: string[]; imageConfig: { aspectRatio: string } } };
  assert.equal(body.contents[0].parts[0].text, 'p');
  assert.deepEqual(body.generationConfig.responseModalities, ['IMAGE']);
  assert.equal(body.generationConfig.imageConfig.aspectRatio, '1:1');
});

test('readGeminiImage takes the first inline image', () => {
  const out = readGeminiImage(png())!;
  assert.equal(out.mimeType, 'image/png');
  assert.equal(Buffer.from(out.bytes).toString(), 'png');
});

test('readGeminiImage also reads snake_case inline_data and jpeg', () => {
  const out = readGeminiImage({ candidates: [{ content: { parts: [{ inline_data: { mime_type: 'image/jpeg', data: Buffer.from('jpg').toString('base64') } }] } }] })!;
  assert.equal(out.mimeType, 'image/jpeg');
});

test('readGeminiImage returns null for a refusal, text only or an unknown type', () => {
  assert.equal(readGeminiImage({ promptFeedback: { blockReason: 'SAFETY' } }), null);
  assert.equal(readGeminiImage({ candidates: [{ content: { parts: [{ text: 'sorry' }] } }] }), null);
  assert.equal(readGeminiImage({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/svg+xml', data: 'PHN2Zz4=' } }] } }] }), null);
  assert.equal(readGeminiImage(null), null);
});

test('generatePromoImage returns null on a non-200 without throwing', async () => {
  assert.equal(await generatePromoImage('p', { geminiKey: 'k', fetchImpl: async () => new Response('no', { status: 429 }) }), null);
});

test('generatePromoImage returns null without any key and never calls out', async () => {
  let called = false;
  assert.equal(await generatePromoImage('p', { geminiKey: '', openRouterKey: '', fetchImpl: async () => { called = true; return new Response('{}'); } }), null);
  assert.equal(called, false);
});

test('generatePromoImage sends the key in a header to the chosen model', async () => {
  let url = '';
  let key: string | null = null;
  const out = await generatePromoImage('p', {
    geminiKey: 'secret',
    geminiModel: 'm-1',
    fetchImpl: async (input, init) => { url = String(input); key = new Headers(init?.headers).get('x-goog-api-key'); return new Response(JSON.stringify(png())); },
  });
  assert.ok(out);
  assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/models/m-1:generateContent');
  assert.equal(key, 'secret');
});

test('the default model is a current flash image model', () => assert.equal(DEFAULT_IMAGE_MODEL, 'gemini-3.1-flash-image'));

const dataUrl = (mime: string, text: string) => `data:${mime};base64,${Buffer.from(text).toString('base64')}`;

test('the OpenRouter request asks for a square image', () => {
  const body = openRouterImageRequest('p', 'm') as { model: string; modalities: string[]; image_config: { aspect_ratio: string }; messages: Array<{ role: string; content: string }> };
  assert.equal(body.model, 'm');
  assert.deepEqual(body.modalities, ['image', 'text']);
  assert.equal(body.image_config.aspect_ratio, '1:1');
  assert.equal(body.messages[0].content, 'p');
});

test('readOpenRouterImage reads the first data-URL image', () => {
  const out = readOpenRouterImage({ choices: [{ message: { images: [{ type: 'image_url', image_url: { url: dataUrl('image/jpeg', 'jpg') } }] } }] })!;
  assert.equal(out.mimeType, 'image/jpeg');
  assert.equal(Buffer.from(out.bytes).toString(), 'jpg');
});

test('readOpenRouterImage returns null for an error, no images, or a web link', () => {
  assert.equal(readOpenRouterImage({ error: { code: 402 } }), null);
  assert.equal(readOpenRouterImage({ choices: [{ message: { content: 'hi' } }] }), null);
  assert.equal(readOpenRouterImage({ choices: [{ message: { images: [{ image_url: { url: 'https://x/y.png' } }] } }] }), null);
});

test('when Gemini refuses, the picture comes from OpenRouter', async () => {
  const calls: string[] = [];
  const out = await generatePromoImage('p', {
    geminiKey: 'g',
    openRouterKey: 'o',
    fetchImpl: async (input, init) => {
      calls.push(String(input));
      if (String(input).includes('googleapis')) return new Response('quota', { status: 429 });
      assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer o');
      return new Response(JSON.stringify({ choices: [{ message: { images: [{ image_url: { url: dataUrl('image/png', 'png') } }] } }] }));
    },
  });
  assert.ok(out);
  assert.equal(calls.length, 2);
  assert.equal(calls[1], 'https://openrouter.ai/api/v1/chat/completions');
});

test('without a Gemini key OpenRouter is asked straight away', async () => {
  const calls: string[] = [];
  await generatePromoImage('p', { openRouterKey: 'o', fetchImpl: async (input) => { calls.push(String(input)); return new Response('{}', { status: 402 }); } });
  assert.deepEqual(calls, ['https://openrouter.ai/api/v1/chat/completions']);
});

test('the OpenRouter default is the same current flash image model', () => assert.equal(DEFAULT_OPENROUTER_IMAGE_MODEL, 'google/gemini-3.1-flash-image'));

test('callTimeout gives a call at most 25 s, and none when under 8 s remain', () => {
  assert.equal(callTimeout(60_000), 25_000);
  assert.equal(callTimeout(12_000), 12_000);
  assert.equal(callTimeout(7_999), null);
});

test('with a small budget a failed Gemini call leaves no time for OpenRouter', async () => {
  const calls: string[] = [];
  let clock = 0;
  const out = await generatePromoImage('p', {
    geminiKey: 'g',
    openRouterKey: 'o',
    budgetMs: 20_000,
    now: () => clock,
    fetchImpl: async (input) => { calls.push(String(input)); clock += 15_000; return new Response('quota', { status: 429 }); },
  });
  assert.equal(out, null);
  assert.equal(calls.length, 1);
});

test('with no budget left nothing is called', async () => {
  let called = false;
  assert.equal(await generatePromoImage('p', { geminiKey: 'g', budgetMs: 5_000, fetchImpl: async () => { called = true; return new Response('{}'); } }), null);
  assert.equal(called, false);
});
