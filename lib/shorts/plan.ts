// A faceless short's plan: the narration line by line, each line's caption
// chunks and its shot, and the sources. The worker writes it, the owner edits
// it, and the worker builds from the approved copy.
//
// Shared by the app and the PC worker (workers/shorts-studio), which runs it
// with Node's type stripping: keep this file free of imports.

export type PlanLine = { text: string; caps: string; shot: string };
export type ShortPlan = { title: string; seconds: number; lines: PlanLine[]; sources: string[]; notes: string };
/** One caption chunk: its words, and the index of the *yellow word (-1 when there is none). */
export type CapChunk = { words: string[]; keyword: number };

export const PLAN_LIMITS = { linesMin: 3, linesMax: 30, text: 300, caps: 300, shot: 300, title: 120, sources: 12, source: 400, notes: 2000, secondsMin: 20, secondsMax: 60 } as const;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const str = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

/** `'WHAT *HAPPENS | IF YOU *SWALLOW'` → two chunks. Empty chunks are dropped. */
export function parseCaps(caps: string): CapChunk[] {
  return caps
    .split('|')
    .map((chunk) => chunk.trim().split(/\s+/).filter(Boolean))
    .filter((words) => words.length > 0)
    .map((words) => ({ words, keyword: words.findIndex((word) => word.startsWith('*')) }));
}

function capErrors(caps: string, line: number): string[] {
  const errors: string[] = [];
  const chunks = parseCaps(caps);
  if (!chunks.length) return [`Line ${line} needs captions.`];
  chunks.forEach((chunk, index) => {
    const where = `Line ${line}, caption ${index + 1}`;
    if (chunk.words.length > 3) errors.push(`${where} has ${chunk.words.length} words (1–3).`);
    const stars = chunk.words.filter((word) => word.startsWith('*')).length;
    if (stars === 0) errors.push(`${where} needs one *yellow word.`);
    if (stars > 1) errors.push(`${where} has ${stars} *yellow words (just one).`);
  });
  return errors;
}

/** Checks a plan against the skill's caption rules and the size limits; returns it trimmed. */
export function validatePlan(input: unknown): { ok: true; plan: ShortPlan } | { ok: false; errors: string[] } {
  if (!isRecord(input) || !Array.isArray(input.lines)) return { ok: false, errors: ['That isn’t a plan.'] };
  const errors: string[] = [];

  const title = str(input.title);
  if (!title) errors.push('The plan needs a title.');
  else if (title.length > PLAN_LIMITS.title) errors.push(`The title is too long (${PLAN_LIMITS.title} characters at most).`);

  const seconds = typeof input.seconds === 'number' ? Math.round(input.seconds) : Number.NaN;
  if (!(seconds >= PLAN_LIMITS.secondsMin && seconds <= PLAN_LIMITS.secondsMax)) errors.push(`The length must be ${PLAN_LIMITS.secondsMin}–${PLAN_LIMITS.secondsMax} seconds.`);

  if (input.lines.length < PLAN_LIMITS.linesMin || input.lines.length > PLAN_LIMITS.linesMax) errors.push(`A plan needs ${PLAN_LIMITS.linesMin}–${PLAN_LIMITS.linesMax} lines.`);

  const lines: PlanLine[] = input.lines.slice(0, PLAN_LIMITS.linesMax).map((raw, index) => {
    const line = isRecord(raw) ? raw : {};
    const text = str(line.text);
    const caps = str(line.caps);
    const shot = str(line.shot);
    const n = index + 1;
    if (!text) errors.push(`Line ${n} needs narration.`);
    else if (text.length > PLAN_LIMITS.text) errors.push(`Line ${n} is too long (${PLAN_LIMITS.text} characters at most).`);
    if (caps.length > PLAN_LIMITS.caps) errors.push(`Line ${n}’s captions are too long.`);
    else errors.push(...capErrors(caps, n));
    if (shot.length > PLAN_LIMITS.shot) errors.push(`Line ${n}’s shot is too long (${PLAN_LIMITS.shot} characters at most).`);
    return { text, caps, shot };
  });

  const sources = (Array.isArray(input.sources) ? input.sources : []).map(str).filter(Boolean);
  if (sources.length > PLAN_LIMITS.sources) errors.push(`At most ${PLAN_LIMITS.sources} sources.`);
  if (sources.some((source) => source.length > PLAN_LIMITS.source)) errors.push('A source is too long.');

  const notes = str(input.notes);
  if (notes.length > PLAN_LIMITS.notes) errors.push('The notes are too long.');

  if (errors.length) return { ok: false, errors };
  return { ok: true, plan: { title, seconds, lines, sources, notes } };
}

/** Spoken words across the narration: about 3 per second sounds natural. */
export function wordCount(plan: Pick<ShortPlan, 'lines'>): number {
  return plan.lines.reduce((sum, line) => sum + line.text.split(/\s+/).filter(Boolean).length, 0);
}
