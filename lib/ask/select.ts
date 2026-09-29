/**
 * Ask Orbis: choosing what a question gets to see.
 *
 * Pure. The model is only as good as what it is handed, and it must never be
 * handed everything: these helpers cut the user's records down to a compact,
 * labelled set that fits a free model's context, with every item carrying an
 * id the answer can cite.
 */

export type AskSource = 'journal' | 'notes' | 'spending' | 'routines' | 'steps';

export const ASK_SOURCES: Array<{ id: AskSource; label: string }> = [
  { id: 'journal', label: 'Journal' },
  { id: 'notes', label: 'Saved notes' },
  { id: 'spending', label: 'Spending' },
  { id: 'routines', label: 'Routines' },
  { id: 'steps', label: 'Steps' },
];

/** The sources a question may read: known ids only, each once. Untrusted input from the browser. */
export function pickSources(value: unknown): AskSource[] {
  if (!Array.isArray(value)) return [];
  const known = new Set<string>(ASK_SOURCES.map((source) => source.id));
  return Array.from(new Set(value.filter((source): source is AskSource => typeof source === 'string' && known.has(source))));
}

export type AskJournal = { date: string; mood: number; body: string; tags: string[] };
export type AskTransaction = { amount: number; currency: string; occurredAt: string; merchant: string | null; category: string | null };
export type AskRoutineEvent = { date: string; title: string; status: string };
export type AskSteps = { date: string; steps: number };

export type Citation = { id: string; label: string };

const STOP = new Set('a an and are as at be but by did do for from had has have how i in is it me my of on or so that the this to was were what when where which who why with you your'.split(' '));

/** Lower-case content words of at least three letters. */
export function terms(text: string): string[] {
  return Array.from(new Set((text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []).filter((word) => !STOP.has(word))));
}

/**
 * Journal entries worth sending in full, best match first: entries that share
 * words with the question, then the most recent to fill the budget. Every other
 * entry still goes as a one-line mood-and-tags summary, so "the weeks I felt
 * stressed" can be found by mood even when the word never appears.
 */
export function rankJournal(question: string, entries: AskJournal[], limit: number): AskJournal[] {
  const wanted = terms(question);
  const scored = entries.map((entry, index) => {
    const haystack = `${entry.body} ${entry.tags.join(' ')}`.toLowerCase();
    const hits = wanted.filter((word) => haystack.includes(word)).length;
    return { entry, hits, index };
  });
  return scored
    .sort((left, right) => right.hits - left.hits || left.index - right.index)
    .slice(0, limit)
    .map((item) => item.entry)
    .sort((left, right) => right.date.localeCompare(left.date));
}

/** Monday of the week a date falls in: '2026-09-28' → '2026-09-28', '2026-10-01' → '2026-09-28'. */
export function weekOf(date: string): string {
  const day = new Date(`${date.slice(0, 10)}T12:00:00Z`);
  const offset = (day.getUTCDay() + 6) % 7;
  day.setUTCDate(day.getUTCDate() - offset);
  return day.toISOString().slice(0, 10);
}

/** India-time calendar date of a timestamp. */
export function istDate(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(iso));
}

/**
 * Spending per week in the most common currency, with the top places. Amounts
 * in other currencies are left out rather than mixed.
 */
export function weeklySpending(transactions: AskTransaction[]) {
  if (!transactions.length) return { currency: null as string | null, weeks: [] as Array<{ week: string; total: number; count: number; top: string[] }> };
  const counts = new Map<string, number>();
  transactions.forEach((row) => counts.set(row.currency, (counts.get(row.currency) ?? 0) + 1));
  const currency = [...counts.entries()].sort((left, right) => right[1] - left[1])[0][0];

  const weeks = new Map<string, { total: number; count: number; places: Map<string, number> }>();
  for (const row of transactions) {
    if (row.currency !== currency) continue;
    const week = weekOf(istDate(row.occurredAt));
    const bucket = weeks.get(week) ?? { total: 0, count: 0, places: new Map() };
    bucket.total += row.amount;
    bucket.count += 1;
    const place = (row.category || row.merchant || '').trim().slice(0, 40);
    if (place) bucket.places.set(place, (bucket.places.get(place) ?? 0) + row.amount);
    weeks.set(week, bucket);
  }
  return {
    currency,
    weeks: [...weeks.entries()]
      .sort((left, right) => right[0].localeCompare(left[0]))
      .map(([week, bucket]) => ({
        week,
        total: Math.round(bucket.total),
        count: bucket.count,
        top: [...bucket.places.entries()].sort((left, right) => right[1] - left[1]).slice(0, 3).map(([place]) => place),
      })),
  };
}

/** Average daily steps per week. */
export function weeklySteps(days: AskSteps[]) {
  const weeks = new Map<string, { total: number; days: number }>();
  for (const day of days) {
    const week = weekOf(day.date);
    const bucket = weeks.get(week) ?? { total: 0, days: 0 };
    bucket.total += day.steps;
    bucket.days += 1;
    weeks.set(week, bucket);
  }
  return [...weeks.entries()]
    .sort((left, right) => right[0].localeCompare(left[0]))
    .map(([week, bucket]) => ({ week, averageSteps: Math.round(bucket.total / bucket.days), days: bucket.days }));
}

/** Routine answers per week: done / skipped / other, per routine title. */
export function weeklyRoutines(events: AskRoutineEvent[]) {
  const weeks = new Map<string, Map<string, { done: number; skipped: number; other: number }>>();
  for (const event of events) {
    const week = weekOf(event.date);
    const titles = weeks.get(week) ?? new Map();
    const tally = titles.get(event.title) ?? { done: 0, skipped: 0, other: 0 };
    if (event.status === 'done' || event.status === 'skipped' || event.status === 'other') tally[event.status] += 1;
    titles.set(event.title, tally);
    weeks.set(week, titles);
  }
  return [...weeks.entries()]
    .sort((left, right) => right[0].localeCompare(left[0]))
    .map(([week, titles]) => ({ week, routines: [...titles.entries()].map(([title, tally]) => ({ title, ...tally })) }));
}

/**
 * The citations an answer may use: only ids that were actually supplied, each
 * with a readable label. Anything the model made up is dropped.
 */
export function keepCitations(cited: unknown, supplied: Map<string, string>, max = 8): Citation[] {
  if (!Array.isArray(cited)) return [];
  const seen = new Set<string>();
  const kept: Citation[] = [];
  for (const value of cited) {
    if (typeof value !== 'string') continue;
    const id = value.trim();
    const label = supplied.get(id);
    if (!label || seen.has(id)) continue;
    seen.add(id);
    kept.push({ id, label });
    if (kept.length >= max) break;
  }
  return kept;
}
