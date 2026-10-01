import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { readAnthropicMessage } from '@/lib/ai/attempt';
import { failureFor, resultOf, type Adapter } from '@/lib/ai/adapters/types';

/**
 * Claude, through the official SDK. The router owns fallback and retries, so the
 * SDK's own retries are off: a retry here would spend money and deadline twice
 * on the same model while a cheaper one waits.
 *
 * There is no JSON mode to switch on. Every Orbis prompt already asks for JSON
 * only, and the caller's accept check decides whether the reply is usable, the
 * same as for every other provider.
 */
export const anthropicMessages: Adapter = async (target, request) => {
  const client = new Anthropic({ apiKey: target.apiKey, baseURL: target.baseUrl, maxRetries: 0 });
  try {
    const message = await client.messages.create({
      model: target.modelId,
      max_tokens: request.maxTokens,
      temperature: request.temperature,
      system: request.system,
      messages: [{ role: 'user', content: request.user }],
    }, { signal: request.signal });
    return resultOf(readAnthropicMessage(message, request.accept), 200, JSON.stringify(message).length);
  } catch (error) {
    if (error instanceof Anthropic.APIUserAbortError || error instanceof Anthropic.APIConnectionTimeoutError) return { outcome: 'timeout', status: null };
    if (error instanceof Anthropic.APIError && typeof error.status === 'number') return { outcome: failureFor(error.status), status: error.status };
    return { outcome: 'failed', status: null };
  }
};
