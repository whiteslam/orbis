'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Flame, LoaderCircle, Trash2 } from 'lucide-react';
import { deleteJournalEntryAction, saveJournalEntryAction } from '@/app/personal/journal-actions';
import { FieldLabel } from '@/components/field/field';
import { MOODS, SUGGESTED_TAGS, type JournalEntry, type JournalSummary } from '@/lib/journal/types';
import { safeAction } from '@/lib/client/safe-action';

/** Past entries shown before "All N past entries". */
const PAST_PREVIEW = 5;

function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}

function prettyDate(date: string) {
  if (date === today()) return 'Today';
  return new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
}

function longDate(date: string) {
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
}

function weekday(date: string) {
  return new Intl.DateTimeFormat('en-IN', { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
}

/** The seven calendar days ending today (India time), oldest first. */
function lastSevenDays(todayKey: string) {
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(`${todayKey}T12:00:00Z`);
    day.setUTCDate(day.getUTCDate() - (6 - index));
    return day.toISOString().slice(0, 10);
  });
}

/**
 * The streak as a number and the last seven days as a segmented bar: filled
 * where there is an entry, empty where a day was missed, and a faint fill for
 * today while it is still open.
 */
function StreakHero({ journal, todayKey }: { journal: JournalSummary; todayKey: string }) {
  const written = new Set(journal.entries.map((entry) => entry.date));
  const days = lastSevenDays(todayKey);
  const missed = days.filter((day) => day !== todayKey && !written.has(day)).map(weekday);
  const count = journal.entries.length;
  // The journal loads the latest 60 entries, so a full page means "at least".
  const countLabel = `${count >= 60 ? '60+' : count} ${count === 1 ? 'entry' : 'entries'}`;
  const summary = [
    missed.length ? `missed ${missed.join(', ')}` : 'written every day',
    written.has(todayKey) ? 'today written' : 'today not written yet',
  ].join('; ');

  return (
    <div className="fd-hero pf-streak">
      <p className="fd-hero-value">{journal.streak}</p>
      <div className="fd-hero-meta">
        <span>{journal.streak === 1 ? 'day in a row' : 'days in a row'}{journal.streak === 0 && !count ? ' · write today to start one' : ''}</span>
        {count > 0 && <span className="fd-delta flat"><Flame size={10} strokeWidth={2.4} aria-hidden="true" />{countLabel}</span>}
      </div>
      <div className="pf-week" role="img" aria-label={`Last seven days: ${summary}.`}>
        {days.map((day) => <i key={day} className={written.has(day) ? 'on' : day === todayKey ? 'open' : undefined} />)}
      </div>
    </div>
  );
}

function Editor({ entry, date, onDone }: { entry: JournalEntry | null; date: string; onDone: () => void }) {
  const router = useRouter();
  const [mood, setMood] = useState<number>(entry?.mood ?? 0);
  const [body, setBody] = useState(entry?.body ?? '');
  const [tags, setTags] = useState<string[]>(entry?.tags ?? []);
  const [message, setMessage] = useState<{ text: string; success: boolean } | null>(null);
  const [isPending, startTransition] = useTransition();
  const isToday = date === today();

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
      const result = await safeAction(saveJournalEntryAction)({ date, mood, body, tags });
      setMessage({ text: result.message, success: result.success });
      if (result.success) {
        router.refresh();
        onDone();
      }
    });
  }

  return (
    <form className="fd-form pf-editor" onSubmit={save}>
      <p className="pf-prompt">{isToday ? 'How are you feeling today?' : `How were you feeling on ${prettyDate(date)}?`}</p>
      <div className="pf-moods" role="radiogroup" aria-label="Mood">
        {MOODS.map((item) => (
          <button key={item.value} type="button" role="radio" aria-checked={mood === item.value} onClick={() => setMood(item.value)} disabled={isPending}>
            <span aria-hidden="true">{item.emoji}</span>{item.label}
          </button>
        ))}
      </div>
      <label className="sr-only" htmlFor={`journal-body-${date}`}>Journal entry</label>
      <textarea id={`journal-body-${date}`} className="pf-textarea" value={body} onChange={(event) => setBody(event.currentTarget.value)} rows={4} maxLength={4000} placeholder="What happened, what you’re grateful for, what’s on your mind…" disabled={isPending} />
      <div className="fd-chips pf-tags" role="group" aria-label="Tags">
        <div>
          {SUGGESTED_TAGS.map((tag) => (
            <button key={tag} type="button" aria-pressed={tags.includes(tag)} onClick={() => toggleTag(tag)} disabled={isPending}>#{tag}</button>
          ))}
        </div>
      </div>
      <div className="fd-act pf-save">
        <button type="submit" disabled={isPending}>{isPending ? <><LoaderCircle className="workbook-spinner" size={14} aria-hidden="true" /> Saving…</> : entry ? 'Update entry' : 'Save entry'}</button>
        {entry && <button className="ghost" type="button" onClick={onDone} disabled={isPending}>Cancel</button>}
        <span className="pf-count">{body.length}/4000</span>
      </div>
      {message && <p className={`fd-msg ${message.success ? 'ok' : 'bad'}`} role="status">{message.text}</p>}
    </form>
  );
}

export function Journal({ journal }: { journal: JournalSummary }) {
  const router = useRouter();
  const [editingDate, setEditingDate] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (journal.state === 'setup') return <><FieldLabel>Journal</FieldLabel><p className="fd-msg bad">Journal isn’t set up yet. Apply the profile/journal migration in Supabase, then refresh.</p></>;
  if (journal.state === 'unavailable') return <><FieldLabel>Journal</FieldLabel><p className="fd-msg bad">Journal could not be loaded. Refresh the app and try again.</p></>;

  const todayKey = today();
  const todayEntry = journal.entries.find((entry) => entry.date === todayKey) ?? null;
  const past = journal.entries.filter((entry) => entry.date !== todayKey);
  const shown = showAll ? past : past.slice(0, PAST_PREVIEW);
  const moodOf = (value: number) => MOODS.find((item) => item.value === value)!;

  function remove(date: string) {
    if (!window.confirm(`Delete your journal entry for ${prettyDate(date)}?`)) return;
    startTransition(async () => {
      await safeAction(deleteJournalEntryAction)(date);
      router.refresh();
    });
  }

  return (
    <>
      <StreakHero journal={journal} todayKey={todayKey} />

      <section className="pf-today" aria-label="Today’s entry">
        <FieldLabel>Today · {longDate(todayKey)}</FieldLabel>
        {todayEntry && editingDate !== todayKey ? (
          <div className="pf-entry-view">
            <p className="pf-prompt"><span aria-hidden="true">{moodOf(todayEntry.mood).emoji}</span> Feeling {moodOf(todayEntry.mood).label.toLowerCase()}</p>
            {todayEntry.body && <p className="fd-prose">{todayEntry.body}</p>}
            {todayEntry.tags.length > 0 && <p className="pf-entry-tags">{todayEntry.tags.map((tag) => `#${tag}`).join(' ')}</p>}
            <div className="fd-act"><button className="ghost" type="button" onClick={() => setEditingDate(todayKey)}>Edit today’s entry</button></div>
          </div>
        ) : (
          <Editor key={todayKey} entry={todayEntry} date={todayKey} onDone={() => setEditingDate(null)} />
        )}
      </section>

      <FieldLabel>Past entries</FieldLabel>
      {past.length ? (
        <div className="pf-entries">
          {shown.map((entry) => (
            <article key={entry.date} className="pf-entry">
              {editingDate === entry.date ? (
                <Editor entry={entry} date={entry.date} onDone={() => setEditingDate(null)} />
              ) : (
                <>
                  <div className="pf-entry-head">
                    <span className="pf-entry-mood" role="img" aria-label={moodOf(entry.mood).label}>{moodOf(entry.mood).emoji}</span>
                    <div><strong>{prettyDate(entry.date)}</strong><small>{moodOf(entry.mood).label}{entry.tags.length ? ` · ${entry.tags.map((tag) => `#${tag}`).join(' ')}` : ''}</small></div>
                    <button type="button" className="pf-delete" aria-label={`Delete entry for ${prettyDate(entry.date)}`} onClick={() => remove(entry.date)} disabled={isPending}><Trash2 size={14} aria-hidden="true" /></button>
                  </div>
                  {entry.body && <p className="pf-entry-body">{entry.body}</p>}
                  <button type="button" className="fd-link pf-edit" onClick={() => setEditingDate(entry.date)}>Edit</button>
                </>
              )}
            </article>
          ))}
          {past.length > PAST_PREVIEW && (
            <button type="button" className="fd-link pf-more" onClick={() => setShowAll(!showAll)} aria-expanded={showAll}>
              {showAll ? 'Show fewer' : journal.entries.length >= 60 ? `Latest ${past.length} past entries` : `All ${past.length} past entries`}
            </button>
          )}
        </div>
      ) : <p className="fd-empty">Your past entries will show up here.</p>}

      <p className="fd-note">Entries stay private to your account. Orbis doesn’t use them for advice or notifications.</p>
    </>
  );
}
