/**
 * Edit history, in words.
 *
 * Client-safe and pure. The database keeps each change as a before/after pair;
 * this turns a pair into the short lines the History view shows, so "what did
 * I change, and when?" reads as an answer rather than as two blobs of JSON.
 */

export type HistoryAction = 'created' | 'edited' | 'deleted';

export type JournalSnapshot = { mood: number; body: string; tags: string[] };

export type JournalRevision = {
  id: string;
  date: string;
  action: HistoryAction;
  previous: JournalSnapshot | null;
  snapshot: JournalSnapshot | null;
  createdAt: string;
};

export type NoteRevision = {
  id: string;
  noteId: string;
  action: HistoryAction;
  previous: string | null;
  snapshot: string | null;
  createdAt: string;
};

const MOOD_LABEL: Record<number, string> = { 1: 'Rough', 2: 'Low', 3: 'Okay', 4: 'Good', 5: 'Great' };

/** A stored snapshot, or null when the value is not one (history is data, so it is checked, not trusted). */
export function toJournalSnapshot(value: unknown): JournalSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const mood = Number(row.mood);
  if (!Number.isInteger(mood) || mood < 1 || mood > 5) return null;
  return {
    mood,
    body: typeof row.body === 'string' ? row.body : '',
    tags: Array.isArray(row.tags) ? row.tags.filter((tag): tag is string => typeof tag === 'string') : [],
  };
}

function wordCount(text: string) {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

/** How the text changed, in one phrase: "added 12 words", "rewrote the text". */
export function textChange(before: string, after: string): string | null {
  if (before === after) return null;
  if (!before.trim()) return 'wrote the text';
  if (!after.trim()) return 'cleared the text';
  const delta = wordCount(after) - wordCount(before);
  if (after.startsWith(before)) return `added ${delta} word${delta === 1 ? '' : 's'}`;
  if (before.startsWith(after)) return `removed ${-delta} word${delta === -1 ? '' : 's'}`;
  return 'edited the text';
}

/** The changes in one journal edit, as short phrases. Empty when nothing visible changed. */
export function journalChanges(previous: JournalSnapshot | null, snapshot: JournalSnapshot | null): string[] {
  if (!previous || !snapshot) return [];
  const changes: string[] = [];
  if (previous.mood !== snapshot.mood) changes.push(`mood ${MOOD_LABEL[previous.mood]} → ${MOOD_LABEL[snapshot.mood]}`);
  const text = textChange(previous.body, snapshot.body);
  if (text) changes.push(text);
  const added = snapshot.tags.filter((tag) => !previous.tags.includes(tag));
  const removed = previous.tags.filter((tag) => !snapshot.tags.includes(tag));
  if (added.length) changes.push(`added ${added.map((tag) => `#${tag}`).join(' ')}`);
  if (removed.length) changes.push(`removed ${removed.map((tag) => `#${tag}`).join(' ')}`);
  return changes;
}

/** One line for a history row: "Edited: mood Okay → Good, added 12 words". */
export function journalRevisionLine(revision: Pick<JournalRevision, 'action' | 'previous' | 'snapshot'>): string {
  if (revision.action === 'created') return 'Written';
  if (revision.action === 'deleted') return 'Deleted';
  const changes = journalChanges(revision.previous, revision.snapshot);
  return changes.length ? `Edited: ${changes.join(', ')}` : 'Edited';
}

export function noteRevisionLine(revision: Pick<NoteRevision, 'action' | 'previous' | 'snapshot'>): string {
  if (revision.action === 'created') return 'Saved';
  if (revision.action === 'deleted') return 'Deleted';
  const change = textChange(revision.previous ?? '', revision.snapshot ?? '');
  return change ? `Edited: ${change}` : 'Edited';
}

/**
 * Journal days whose entry is gone: the latest revision for the day is a
 * delete and no entry exists for it now. Newest first. These are what "Deleted
 * entries" offers to bring back.
 */
export function deletedJournalDays(revisions: JournalRevision[], existing: Set<string>): JournalRevision[] {
  const latest = new Map<string, JournalRevision>();
  for (const revision of revisions) {
    const seen = latest.get(revision.date);
    if (!seen || revision.createdAt > seen.createdAt) latest.set(revision.date, revision);
  }
  return [...latest.values()]
    .filter((revision) => revision.action === 'deleted' && revision.previous && !existing.has(revision.date))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

/** "28 Sept, 2:14 pm" in India time. */
export function historyTime(iso: string): string {
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }).format(new Date(iso));
}
