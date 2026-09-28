import 'server-only';

import { createClient } from '@/lib/supabase/server';
import {
  istDate, rankJournal, weeklyRoutines, weeklySpending, weeklySteps,
  type AskJournal, type AskSource,
} from '@/lib/ask/select';

/** How far back a question can see. Long enough for "the last few months", short enough to stay small. */
const LOOKBACK_DAYS = 180;
/** Journal entries sent with their text; the rest go as mood-and-tags lines. */
const FULL_ENTRIES = 25;
const ENTRY_CHARS = 500;

const MOOD = ['', 'rough', 'low', 'okay', 'good', 'great'];

function daysAgo(days: number) {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

function shortDate(date: string) {
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
}

export type AskContext = {
  /** The data block sent to the model. */
  data: Record<string, unknown>;
  /** Every id the answer may cite, with its readable label. */
  citations: Map<string, string>;
  /** Sources that had something in them. */
  used: AskSource[];
};

/**
 * Gathers only the sources the user ticked, through their own RLS session.
 *
 * Every item carries an id ("journal:2026-09-12", "spending:2026-09-07") so the
 * answer can point back at what it relied on. Missing tables or errors leave a
 * source empty rather than failing the question.
 */
export async function buildAskContext(userId: string, question: string, sources: AskSource[]): Promise<AskContext> {
  const supabase = await createClient();
  const since = daysAgo(LOOKBACK_DAYS);
  const want = new Set(sources);
  const none = Promise.resolve({ data: null, error: null });

  const [journal, notes, transactions, events, steps] = await Promise.all([
    want.has('journal') ? supabase.from('journal_entries').select('entry_date,mood,body,tags').eq('user_id', userId).gte('entry_date', since).order('entry_date', { ascending: false }).limit(200) : none,
    want.has('notes') ? supabase.from('user_context_notes').select('id,note,updated_at').eq('user_id', userId).order('updated_at', { ascending: false }).limit(30) : none,
    want.has('spending') ? supabase.from('transactions').select('amount,currency,occurred_at,merchant,category').eq('user_id', userId).eq('direction', 'expense').gte('occurred_at', `${since}T00:00:00Z`).limit(3000) : none,
    want.has('routines') ? supabase.from('routine_events').select('local_date,title,status').eq('user_id', userId).gte('local_date', since).limit(2000) : none,
    want.has('steps') ? supabase.from('health_daily_steps').select('date,steps').eq('user_id', userId).gte('date', since).limit(400) : none,
  ]);

  const data: Record<string, unknown> = { today: istDate(new Date().toISOString()), lookbackStarts: since };
  const citations = new Map<string, string>();
  const used: AskSource[] = [];

  const entries: AskJournal[] = ((journal.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    date: String(row.entry_date),
    mood: Number(row.mood),
    body: typeof row.body === 'string' ? row.body : '',
    tags: Array.isArray(row.tags) ? (row.tags as string[]) : [],
  }));
  if (entries.length) {
    const full = new Set(rankJournal(question, entries, FULL_ENTRIES).map((entry) => entry.date));
    data.journal = entries.map((entry) => ({
      id: `journal:${entry.date}`,
      date: entry.date,
      mood: MOOD[entry.mood] ?? 'unknown',
      tags: entry.tags,
      ...(full.has(entry.date) && entry.body.trim() ? { text: entry.body.trim().slice(0, ENTRY_CHARS) } : {}),
    }));
    entries.forEach((entry) => citations.set(`journal:${entry.date}`, `Journal, ${shortDate(entry.date)}`));
    used.push('journal');
  }

  const noteRows = (notes.data ?? []) as Array<Record<string, unknown>>;
  if (noteRows.length) {
    data.savedNotes = noteRows.map((row, index) => ({ id: `note:${index + 1}`, text: String(row.note).slice(0, 400) }));
    noteRows.forEach((row, index) => citations.set(`note:${index + 1}`, `Saved note: “${String(row.note).slice(0, 40)}${String(row.note).length > 40 ? '…' : ''}”`));
    used.push('notes');
  }

  const spending = weeklySpending(((transactions.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    amount: Number(row.amount),
    currency: String(row.currency),
    occurredAt: String(row.occurred_at),
    merchant: typeof row.merchant === 'string' ? row.merchant : null,
    category: typeof row.category === 'string' ? row.category : null,
  })));
  if (spending.weeks.length) {
    data.spendingByWeek = { currency: spending.currency, weeks: spending.weeks.map((week) => ({ id: `spending:${week.week}`, weekStarting: week.week, total: week.total, payments: week.count, topPlaces: week.top })) };
    spending.weeks.forEach((week) => citations.set(`spending:${week.week}`, `Spending, week of ${shortDate(week.week)}`));
    used.push('spending');
  }

  const routineWeeks = weeklyRoutines(((events.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    date: String(row.local_date), title: String(row.title), status: String(row.status),
  })));
  if (routineWeeks.length) {
    data.routinesByWeek = routineWeeks.map((week) => ({ id: `routines:${week.week}`, weekStarting: week.week, routines: week.routines }));
    routineWeeks.forEach((week) => citations.set(`routines:${week.week}`, `Routines, week of ${shortDate(week.week)}`));
    used.push('routines');
  }

  const stepWeeks = weeklySteps(((steps.data ?? []) as Array<Record<string, unknown>>).map((row) => ({ date: String(row.date), steps: Number(row.steps) })));
  if (stepWeeks.length) {
    data.stepsByWeek = stepWeeks.map((week) => ({ id: `steps:${week.week}`, weekStarting: week.week, averageSteps: week.averageSteps, daysRecorded: week.days }));
    stepWeeks.forEach((week) => citations.set(`steps:${week.week}`, `Steps, week of ${shortDate(week.week)}`));
    used.push('steps');
  }

  return { data, citations, used };
}
