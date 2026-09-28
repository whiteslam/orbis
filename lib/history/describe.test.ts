import { describe, expect, it } from 'vitest';
import { deletedJournalDays, journalChanges, journalRevisionLine, noteRevisionLine, textChange, toJournalSnapshot, type JournalRevision } from '@/lib/history/describe';

const entry = (mood: number, body: string, tags: string[] = []) => ({ mood, body, tags });

describe('textChange', () => {
  it('names additions, removals and rewrites', () => {
    expect(textChange('Went for a run', 'Went for a run and swam')).toBe('added 2 words');
    expect(textChange('Went for a run and swam', 'Went for a run')).toBe('removed 2 words');
    expect(textChange('A', 'B')).toBe('edited the text');
    expect(textChange('', 'Hello')).toBe('wrote the text');
    expect(textChange('Hello', ' ')).toBe('cleared the text');
    expect(textChange('Same', 'Same')).toBeNull();
  });
});

describe('journalChanges', () => {
  it('lists mood, text and tag changes', () => {
    expect(journalChanges(entry(3, 'Hi', ['work']), entry(4, 'Hi there', ['rest']))).toEqual([
      'mood Okay → Good', 'added 1 word', 'added #rest', 'removed #work',
    ]);
  });

  it('is empty without both sides', () => {
    expect(journalChanges(null, entry(3, ''))).toEqual([]);
  });
});

describe('revision lines', () => {
  it('describes each action', () => {
    expect(journalRevisionLine({ action: 'created', previous: null, snapshot: entry(3, '') })).toBe('Written');
    expect(journalRevisionLine({ action: 'deleted', previous: entry(3, ''), snapshot: null })).toBe('Deleted');
    expect(journalRevisionLine({ action: 'edited', previous: entry(2, 'a'), snapshot: entry(5, 'a') })).toBe('Edited: mood Low → Great');
    expect(noteRevisionLine({ action: 'edited', previous: 'Likes tea', snapshot: 'Likes tea a lot' })).toBe('Edited: added 2 words');
  });
});

describe('toJournalSnapshot', () => {
  it('rejects anything that is not a snapshot', () => {
    expect(toJournalSnapshot(null)).toBeNull();
    expect(toJournalSnapshot({ mood: 9 })).toBeNull();
    expect(toJournalSnapshot({ mood: 2, body: 'x', tags: ['a', 3] })).toEqual({ mood: 2, body: 'x', tags: ['a'] });
  });
});

describe('deletedJournalDays', () => {
  const revision = (id: string, date: string, action: JournalRevision['action'], createdAt: string): JournalRevision => ({
    id, date, action, createdAt,
    previous: action === 'created' ? null : entry(3, 'old'),
    snapshot: action === 'deleted' ? null : entry(3, 'old'),
  });

  it('keeps days whose latest change was a delete and that have no entry now', () => {
    const revisions = [
      revision('1', '2026-09-01', 'created', '2026-09-01T10:00:00Z'),
      revision('2', '2026-09-01', 'deleted', '2026-09-02T10:00:00Z'),
      revision('3', '2026-09-03', 'deleted', '2026-09-03T10:00:00Z'),
      revision('4', '2026-09-03', 'created', '2026-09-04T10:00:00Z'),
      revision('5', '2026-09-05', 'deleted', '2026-09-06T10:00:00Z'),
    ];
    expect(deletedJournalDays(revisions, new Set(['2026-09-05'])).map((item) => item.id)).toEqual(['2']);
  });
});
