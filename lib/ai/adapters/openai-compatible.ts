import 'server-only';

import { readCompletion } from '@/lib/ai/attempt';
import { failureFor, isTimeout, resultOf, type Adapter } from '@/lib/ai/adapters/types';

/** Groq, Gemini, Mistral and OpenRouter: the OpenAI chat-completions shape, with JSON mode. */
export const openAiCompatible: Adapter = async (target, request) => {
  try {
    const response = await fetch(`${target.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${target.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: target.modelId,
        messages: [{ role: 'system', content: request.system }, { role: 'user', content: request.user }],
        temperature: request.temperature,
        max_tokens: request.maxTokens,
        response_format: { type: 'json_object' },
        // Whatever else this model needs, from its registry row. Reasoning
        // effort lives there because providers spell it differently, Groq
        // rejects OpenRouter's spelling outright, and within Groq one model
        // needs it while another fails because of it.
        ...target.extra,
      }),
      cache: 'no-store',
      signal: request.signal,
    });
    if (!response.ok) return { outcome: failureFor(response.status), status: response.status };
    const raw = await response.text();
    return resultOf(readCompletion(raw, request.accept), response.status, raw.length);
  } catch (error) {
    return { outcome: isTimeout(error) ? 'timeout' : 'failed', status: null };
  }
};
