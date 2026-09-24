import 'server-only';

const MAX_RESPONSE_BYTES = 128 * 1024;

export const openRouterModel = () => process.env.OPENROUTER_MODEL?.trim() || 'openai/gpt-4o-mini';

export class OpenRouterError extends Error {
  constructor(message: string, readonly status: number | null) {
    super(message);
  }
}

// Sends one JSON-mode chat request and returns the model's text.
export async function requestOpenRouterJson({ system, user, maxTokens, title, timeoutMs = 30_000 }: { system: string; user: string; maxTokens: number; title: string; timeoutMs?: number }) {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) throw new OpenRouterError('AI suggestions are not configured yet. Add OPENROUTER_API_KEY to the server environment.', null);

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
      'http-referer': process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000',
      'x-title': title,
    },
    body: JSON.stringify({
      model: openRouterModel(),
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      temperature: 0.2,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
      // Thinking models (e.g. Gemini) spend output tokens on reasoning; keep it low so JSON isn't cut off.
      reasoning: { effort: 'low' },
    }),
    cache: 'no-store',
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    if (response.status === 401 || response.status === 402) throw new OpenRouterError('The AI provider could not authorize this request. Check the OpenRouter key and account balance.', response.status);
    if (response.status === 429) throw new OpenRouterError('AI requests are temporarily limited. Wait a moment and try again.', response.status);
    throw new OpenRouterError('The AI provider could not respond right now. Try again shortly.', response.status);
  }

  const raw = await response.text();
  if (Buffer.byteLength(raw, 'utf8') > MAX_RESPONSE_BYTES) throw new OpenRouterError('The AI provider response is too large.', response.status);
  const data = JSON.parse(raw) as { choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }> };
  const content = data.choices?.[0]?.message?.content;
  const text = typeof content === 'string' ? content : Array.isArray(content) ? content.filter((part) => part.type === 'text').map((part) => part.text ?? '').join('') : '';
  return { text, status: response.status };
}
