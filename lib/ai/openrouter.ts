import 'server-only';

const MAX_RESPONSE_BYTES = 128 * 1024;

export const openRouterModel = () => process.env.OPENROUTER_MODEL?.trim() || 'openai/gpt-4o-mini';

export class OpenRouterError extends Error {
  constructor(message: string, readonly status: number | null) {
    super(message);
  }
}

/**
 * What remains of the direct OpenRouter client.
 *
 * Every feature that sends personal data now goes through lib/ai/router.ts,
 * which will only reach a provider whose registry row says it will not train on
 * what it receives. The one caller left is the embeddings path, which the
 * registry does not yet model; see lib/health-docs/embeddings.ts.
 */
export const openRouterKey = () => process.env.OPENROUTER_API_KEY?.trim() ?? '';
