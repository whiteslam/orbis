import 'server-only';

import { routeJson } from '@/lib/ai/router';
import { briefSystemPrompt, parseBrief, type BriefSurface } from '@/lib/brief/style';

export type { BriefSurface };

/**
 * The one place Orbis asks a model to write a brief.
 *
 * There used to be two: a Groq-backed notification writer with its own per-slot
 * prompts, and an OpenRouter-backed home-brief writer with its own. They read
 * different facts and phrased them differently, so the 7 pm push and the 7 pm
 * note could disagree about the same day. Both now send the same snapshot
 * through the same prompt and the same parser; only the length differs.
 *
 * Sensitivity is not a comment here. A brief snapshot is personal by
 * definition (spending, routines, holdings), so the router is asked for a
 * provider whose registry row says it will not train on what it receives. If
 * there is none this returns null, and each caller uses wording Orbis composed
 * itself rather than sending the data somewhere that would keep it.
 */
export type WrittenBrief = { title: string | null; caption: string; writtenBy: string };

export async function writeBrief(userId: string, snapshot: unknown, surface: BriefSurface): Promise<WrittenBrief | null> {
  const result = await routeJson({
    userId,
    feature: surface === 'push' ? 'daily_notification' : 'home_brief',
    sensitivity: 'personal',
    system: briefSystemPrompt(surface),
    user: `Write ${surface === 'push' ? "today's notification" : "today's note"} from this snapshot.\n${JSON.stringify(snapshot)}`,
    maxTokens: surface === 'push' ? 400 : 600,
    timeoutMs: surface === 'push' ? 12_000 : 20_000,
  });
  if (!result) return null;

  const written = parseBrief(result.text, surface);
  if (!written) return null;
  return { ...written, writtenBy: `${result.providerId}/${result.modelId}` };
}
