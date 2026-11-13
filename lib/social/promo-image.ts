// One square picture for an Orbis promotion post, from Gemini's image model:
// straight from Google with GEMINI_API_KEY (needs billing on that project;
// the free tier allows no images), else the same model through OpenRouter
// (needs at least $1 of credit there). Requests and reply-reading are pure and
// unit-tested; the call never throws: any failure is null, and the post keeps
// its tinted card.

export const DEFAULT_IMAGE_MODEL = 'gemini-3.1-flash-image';
export const DEFAULT_OPENROUTER_IMAGE_MODEL = 'google/gemini-3.1-flash-image';
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const TIMEOUT_MS = 60_000;
const MIME = new Set(['image/png', 'image/jpeg']);

export type PromoImage = { bytes: Uint8Array; mimeType: 'image/png' | 'image/jpeg' };

export function geminiImageRequest(prompt: string) {
  return {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '1:1' } },
  };
}

type Part = { inlineData?: { mimeType?: string; data?: string }; inline_data?: { mime_type?: string; data?: string } };

/** The first PNG or JPEG in the reply, or null (a refusal, text only, anything else). */
export function readGeminiImage(json: unknown): PromoImage | null {
  const candidates = (json as { candidates?: Array<{ content?: { parts?: Part[] } }> } | null)?.candidates;
  if (!Array.isArray(candidates)) return null;
  for (const candidate of candidates) {
    for (const part of candidate?.content?.parts ?? []) {
      const mimeType = part.inlineData?.mimeType ?? part.inline_data?.mime_type;
      const data = part.inlineData?.data ?? part.inline_data?.data;
      if (typeof data !== 'string' || !data || !mimeType || !MIME.has(mimeType)) continue;
      return { bytes: new Uint8Array(Buffer.from(data, 'base64')), mimeType: mimeType as PromoImage['mimeType'] };
    }
  }
  return null;
}

export function openRouterImageRequest(prompt: string, model: string) {
  return { model, modalities: ['image', 'text'], image_config: { aspect_ratio: '1:1' }, messages: [{ role: 'user', content: prompt }] };
}

/** The first PNG or JPEG data URL in an OpenRouter reply, or null. A web link is never fetched. */
export function readOpenRouterImage(json: unknown): PromoImage | null {
  const choices = (json as { choices?: Array<{ message?: { images?: Array<{ image_url?: { url?: unknown } }> } }> } | null)?.choices;
  if (!Array.isArray(choices)) return null;
  for (const choice of choices) {
    for (const image of choice?.message?.images ?? []) {
      const url = image?.image_url?.url;
      if (typeof url !== 'string') continue;
      const match = /^data:(image\/(?:png|jpeg));base64,(.+)$/.exec(url);
      if (match) return { bytes: new Uint8Array(Buffer.from(match[2], 'base64')), mimeType: match[1] as PromoImage['mimeType'] };
    }
  }
  return null;
}

export type ImageOptions = {
  geminiKey?: string;
  geminiModel?: string;
  openRouterKey?: string;
  openRouterModel?: string;
  fetchImpl?: typeof fetch;
};

/** One JSON POST; the parsed reply, or null on any failure (logged without secrets). */
async function post(label: string, url: string, headers: Record<string, string>, body: unknown, fetchImpl: typeof fetch): Promise<unknown> {
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      console.error(`${label} image request failed`, response.status);
      return null;
    }
    return await response.json();
  } catch (error) {
    console.error(`${label} image request failed`, error instanceof Error ? error.name : 'unknown');
    return null;
  }
}

/** Gemini first when it has a key, then OpenRouter; null when neither gives a picture. */
export async function generatePromoImage(prompt: string, options: ImageOptions): Promise<PromoImage | null> {
  const fetchImpl = options.fetchImpl ?? fetch;
  if (options.geminiKey) {
    const model = options.geminiModel || DEFAULT_IMAGE_MODEL;
    const image = readGeminiImage(await post('Gemini', `${ENDPOINT}/${encodeURIComponent(model)}:generateContent`, { 'x-goog-api-key': options.geminiKey }, geminiImageRequest(prompt), fetchImpl));
    if (image) return image;
  }
  if (options.openRouterKey) {
    const model = options.openRouterModel || DEFAULT_OPENROUTER_IMAGE_MODEL;
    const image = readOpenRouterImage(await post('OpenRouter', OPENROUTER_ENDPOINT, { authorization: `Bearer ${options.openRouterKey}`, 'x-title': 'Orbis' }, openRouterImageRequest(prompt, model), fetchImpl));
    if (image) return image;
  }
  return null;
}
