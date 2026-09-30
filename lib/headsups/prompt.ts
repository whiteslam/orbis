import type { Finding, Wording } from '@/lib/headsups/types';

export const TITLE_MAX = 80;
export const BODY_MAX = 300;
export const LABEL_MAX = 40;

const SYSTEM = [
  'You word short heads-ups for Orbis, a private personal app.',
  'You are given one thing Orbis noticed: its kind, the numbers behind it, and a plain default wording.',
  'Rewrite it to sound warm, specific and brief, like a thoughtful friend, never alarming or preachy.',
  'Use only the numbers given. Never add facts, advice about money products, or medical claims.',
  'Amounts are in the given currency; write them the way people in India would (₹14,200).',
  `Reply with JSON only: {"title": ≤${TITLE_MAX} chars, "body": ≤${BODY_MAX} chars, "actionLabel": ≤${LABEL_MAX} chars}.`,
  'The action label names the one next step, like the default does.',
].join('\n');

export function wordingPrompt(finding: Finding) {
  return {
    system: SYSTEM,
    user: JSON.stringify({ kind: finding.kind, evidence: finding.evidence, fallback: finding.fallback }),
  };
}

function field(value: unknown, max: number) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= max ? trimmed : null;
}

/** The model's wording, or null to use Orbis's own. */
export function parseWording(text: string): Wording | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  const record = data as Record<string, unknown>;
  const title = field(record.title, TITLE_MAX);
  const body = field(record.body, BODY_MAX);
  const actionLabel = field(record.actionLabel, LABEL_MAX);
  return title && body && actionLabel ? { title, body, actionLabel } : null;
}
