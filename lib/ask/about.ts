// "Ask Orbis about this": a story, a market reading or a holding from another
// card, handed to the Ask panel to ask a question about.
//
// Client-safe. Cards call openAsk(); the panel listens for ASK_EVENT; the
// server action re-checks the shape with readAbout(), because what the browser
// sends is only ever a suggestion of what was on screen.

export type AskAbout = {
  kind: 'news' | 'market' | 'holding';
  title: string;
  detail: string;
  url?: string;
};

export type AskRequest = { about: AskAbout; question: string };

export const ASK_EVENT = 'orbis:ask';

const KINDS = new Set<AskAbout['kind']>(['news', 'market', 'holding']);

function text(value: unknown, max: number) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

export function readAbout(value: unknown): AskAbout | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const kind = record.kind as AskAbout['kind'];
  const title = text(record.title, 200);
  const detail = text(record.detail, 800);
  if (!KINDS.has(kind) || !title) return null;
  let url: string | undefined;
  if (typeof record.url === 'string') {
    try {
      const parsed = new URL(record.url);
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') url = parsed.toString().slice(0, 500);
    } catch {
      // A bad link is dropped, not the question.
    }
  }
  return { kind, title, detail, ...(url ? { url } : {}) };
}

/** Opens Ask Orbis with this attached and a question ready to edit or send. */
export function openAsk(about: AskAbout, question: string) {
  window.dispatchEvent(new CustomEvent<AskRequest>(ASK_EVENT, { detail: { about, question } }));
}
