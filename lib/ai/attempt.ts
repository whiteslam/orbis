/**
 * Reading one model's reply. Pure, so the rules are unit-tested.
 *
 * A reply only counts when the caller can use it. The router used to return the
 * first non-empty text, so a model that answered with broken JSON ended the
 * request even when the next model in the registry would have answered
 * properly. Callers now say what "usable" means, and anything else is
 * 'invalid', which the router treats like any other failure: try the next one.
 */
export type TokenUsage = { inputTokens: number; outputTokens: number };

export type Completion =
  | { kind: 'ok'; text: string; usage: TokenUsage | null }
  | { kind: 'invalid'; usage: TokenUsage | null };

const count = (value: unknown) => (typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null);

function usageFrom(input: unknown, output: unknown): TokenUsage | null {
  const inputTokens = count(input);
  const outputTokens = count(output);
  return inputTokens === null || outputTokens === null ? null : { inputTokens, outputTokens };
}

/** JSON a model wrapped in a Markdown code fence, unwrapped. */
function unfence(text: string) {
  const match = text.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1] : text;
}

/** The shared verdict: empty or unusable text is invalid, whichever provider sent it. */
function judge(content: unknown, usage: TokenUsage | null, accept?: (text: string) => boolean): Completion {
  const text = typeof content === 'string' ? unfence(content) : '';
  if (!text.trim()) return { kind: 'invalid', usage };
  try {
    if (accept && !accept(text)) return { kind: 'invalid', usage };
  } catch {
    return { kind: 'invalid', usage };
  }
  return { kind: 'ok', text, usage };
}

/** An OpenAI-compatible chat completion body (Groq, Gemini, Mistral, OpenRouter). Usage is never estimated. */
export function readCompletion(raw: string, accept?: (text: string) => boolean): Completion {
  let data: { choices?: Array<{ message?: { content?: unknown } }>; usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } };
  try {
    data = JSON.parse(raw);
  } catch {
    return { kind: 'invalid', usage: null };
  }
  const usage = data?.usage ? usageFrom(data.usage.prompt_tokens, data.usage.completion_tokens) : null;
  return judge(data?.choices?.[0]?.message?.content, usage, accept);
}

/**
 * An Anthropic Messages API reply. Text blocks are joined; anything else
 * (thinking, for instance) is not part of the answer. A refusal is never a
 * usable answer, whatever text came with it.
 */
export function readAnthropicMessage(message: unknown, accept?: (text: string) => boolean): Completion {
  if (!message || typeof message !== 'object') return { kind: 'invalid', usage: null };
  const reply = message as { content?: unknown; stop_reason?: unknown; usage?: { input_tokens?: unknown; output_tokens?: unknown } };
  const usage = reply.usage ? usageFrom(reply.usage.input_tokens, reply.usage.output_tokens) : null;
  if (!Array.isArray(reply.content) || reply.stop_reason === 'refusal') return { kind: 'invalid', usage };
  const text = reply.content
    .filter((block): block is { type: 'text'; text: string } => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('');
  return judge(text, usage, accept);
}
