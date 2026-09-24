'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { BookOpen, Flame, LoaderCircle, Trash2 } from 'lucide-react';
import { deleteJournalEntryAction, saveJournalEntryAction } from '@/app/personal/journal-actions';
import { MOODS, SUGGESTED_TAGS, type JournalEntry, type JournalSummary } from '@/lib/journal/types';

function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}

function prettyDate(date: string) {
  if (date === today()) return 'Today';
  return new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
}

function Editor({ entry, date, onDone }: { entry: JournalEntry | null; date: string; onDone: () => void }) {
  const router = useRouter();
  const [mood, setMood] = useState<number>(entry?.mood ?? 0);
  const [body, setBody] = useState(entry?.body ?? '');
  const [tags, setTags] = useState<string[]>(entry?.tags ?? []);
  const [message, setMessage] = useState<{ text: string; success: boolean } | null>(null);
  const [isPending, startTransition] = useTransition();

  function toggleTag(tag: string) {
    setTags((current) => current.includes(tag) ? current.filter((item) => item !== tag) : current.length < 8 ? [...current, tag] : current);
  }

  function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!mood) {
      setMessage({ text: 'Pick how you’re feeling first.', success: false });
      return;
    }
    setMessage(null);
    startTransition(async () => {
      const result = await saveJournalEntryAction({ date, mood, body, tags });
      setMessage({ text: result.message, success: result.success });
      if (result.success) {
        router.refresh();
        onDone();
      }
    });
  }

  return (
    <form className="journal-editor" onSubmit={save}>
      <p className="journal-prompt">{date === today() ? 'How are you feeling today?' : `How were you feeling on ${prettyDate(date)}?`}</p>
      <div className="journal-moods" role="radiogroup" aria-label="Mood">
        {MOODS.map((item) => (
          <button key={item.value} type="button" role="radio" aria-checked={mood === item.value} className={mood === item.value ? 'active' : ''} onClick={() => setMood(item.value)} disabled={isPending}>
            <span aria-hidden="true">{item.emoji}</span>{item.label}
          </button>
        ))}
      </div>
      <textarea value={body} onChange={(event) => setBody(event.currentTarget.value)} rows={4} maxLength={4000} placeholder="What happened, what you’re grateful for, what’s on your mind…" disabled={isPending} />
      <div className="journal-tags">
        {SUGGESTED_TAGS.map((tag) => (
          <button key={tag} type="button" aria-pressed={tags.includes(tag)} className={tags.includes(tag) ? 'active' : ''} onClick={() => toggleTag(tag)} disabled={isPending}>#{tag}</button>
        ))}
      </div>
      <div className="journal-actions">
        <button className="finance-button primary" type="submit" disabled={isPending}>{isPending ? <><LoaderCircle className="workbook-spinner" size={13} /> Saving…</> : entry ? 'Update entry' : 'Save entry'}</button>
        <small>{body.length}/4000</small>
      </div>
      {message && <p className={`gmail-review-message ${message.success ? 'success' : ''}`} role="status">{message.text}</p>}
    </form>
  );
}

export function Journal({ journal }: { journal: JournalSummary }) {
  const router = useRouter();
  const [editingDate, setEditingDate] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (journal.state === 'setup') return <div className="empty-state"><BookOpen size={22} /><strong>Journal isn’t set up yet</strong><p>Apply the profile/journal migration in Supabase, then refresh.</p></div>;
  if (journal.state === 'unavailable') return <div className="empty-state"><BookOpen size={22} /><strong>Journal could not be loaded</strong><p>Refresh the app and try again.</p></div>;

  const todayKey = today();
  const todayEntry = journal.entries.find((entry) => entry.date === todayKey) ?? null;
  const past = journal.entries.filter((entry) => entry.date !== todayKey);
  const moodOf = (value: number) => MOODS.find((item) => item.value === value)!;

  function remove(date: string) {
    if (!window.confirm(`Delete your journal entry for ${prettyDate(date)}?`)) return;
    startTransition(async () => {
      await deleteJournalEntryAction(date);
      router.refresh();
    });
  }

  return (
    <>
      <section className="journal-today">
        <div className="journal-head">
          <div><small>JOURNAL</small><h3>{prettyDate(todayKey)}</h3></div>
          <span className={`journal-streak ${journal.streak ? 'on' : ''}`}><Flame size={13} aria-hidden="true" />{journal.streak} day{journal.streak === 1 ? '' : 's'}</span>
        </div>
        {todayEntry && editingDate !== todayKey ? (
          <div className="journal-entry-view">
            <p><span aria-hidden="true">{moodOf(todayEntry.mood).emoji}</span> Feeling {moodOf(todayEntry.mood).label.toLowerCase()}</p>
            {todayEntry.body && <blockquote>{todayEntry.body}</blockquote>}
            {todayEntry.tags.length > 0 && <div className="journal-entry-tags">{todayEntry.tags.map((tag) => <span key={tag}>#{tag}</span>)}</div>}
            <button className="finance-button secondary" type="button" onClick={() => setEditingDate(todayKey)}>Edit today’s entry</button>
          </div>
        ) : (
          <Editor key={todayKey} entry={todayEntry} date={todayKey} onDone={() => setEditingDate(null)} />
        )}
      </section>

      <div className="section-title"><h3>Past entries</h3></div>
      {past.length ? (
        <div className="journal-list">
          {past.map((entry) => (
            <article key={entry.date} className="journal-item">
              {editingDate === entry.date ? (
                <Editor entry={entry} date={entry.date} onDone={() => setEditingDate(null)} />
              ) : (
                <>
                  <div className="journal-item-head">
                    <span className="journal-item-mood" aria-label={moodOf(entry.mood).label}>{moodOf(entry.mood).emoji}</span>
                    <div><strong>{prettyDate(entry.date)}</strong><small>{moodOf(entry.mood).label}{entry.tags.length ? ` · ${entry.tags.map((tag) => `#${tag}`).join(' ')}` : ''}</small></div>
                    <button type="button" className="workbook-icon-button" aria-label={`Delete entry for ${prettyDate(entry.date)}`} onClick={() => remove(entry.date)} disabled={isPending}><Trash2 size={14} /></button>
                  </div>
                  {entry.body && <p>{entry.body}</p>}
                  <button type="button" className="journal-edit-link" onClick={() => setEditingDate(entry.date)}>Edit</button>
                </>
              )}
            </article>
          ))}
        </div>
      ) : <p className="groww-muted">Your past entries will show up here.</p>}
    </>
  );
}
