import 'server-only';

import type { JournalEntry, JournalSummary } from '@/lib/journal/types';
import { createClient } from '@/lib/supabase/server';

function istToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}

function previousDay(date: string) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
}

// Consecutive days with an entry, ending today (or yesterday if today is still open).
function streakOf(dates: Set<string>) {
  let day = istToday();
  if (!dates.has(day)) day = previousDay(day);
  let streak = 0;
  while (dates.has(day)) {
    streak += 1;
    day = previousDay(day);
  }
  return streak;
}

export async function getJournal(userId: string): Promise<JournalSummary> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('journal_entries')
    .select('entry_date,mood,body,tags')
    .eq('user_id', userId)
    .order('entry_date', { ascending: false })
    .limit(60);
  if (error) {
    const missing = ['PGRST205', 'PGRST204', '42P01'].includes(error.code ?? '');
    return { state: missing ? 'setup' : 'unavailable', entries: [], streak: 0 };
  }
  const entries: JournalEntry[] = (data ?? []).map((row) => ({
    date: row.entry_date,
    mood: row.mood as JournalEntry['mood'],
    body: row.body,
    tags: row.tags ?? [],
  }));
  return { state: 'ready', entries, streak: streakOf(new Set(entries.map((entry) => entry.date))) };
}
