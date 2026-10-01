import 'server-only';

import { anthropicMessages } from '@/lib/ai/adapters/anthropic';
import { openAiCompatible } from '@/lib/ai/adapters/openai-compatible';
import type { Adapter } from '@/lib/ai/adapters/types';

/**
 * api_style → adapter. A style with no adapter here is never used, so a registry
 * row cannot route a request to code that does not exist.
 *
 * Jev is not here yet: its API, pricing and data terms are not documented
 * anywhere this project can see, and an adapter written from a guess would send
 * real data to an unknown shape. Add it as its own file and style once they are.
 */
export const ADAPTERS: Record<string, Adapter> = {
  openai: openAiCompatible,
  anthropic: anthropicMessages,
};
