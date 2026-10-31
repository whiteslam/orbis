'use client';

import { useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Flame, LoaderCircle, Trash2 } from 'lucide-react';
import { deleteJournalEntryAction, loadDeletedJournalAction, loadJournalHistoryAction, saveJournalEntryAction } from '@/app/personal/journal-actions';
import { FieldLabel } from '@/components/field/field';
import { HistoryPanel, type HistoryRow } from '@/components/journal/history-panel';
import { VoiceNotes } from '@/components/journal/voice-notes';
import { journalRevisionLine, type JournalRevision } from '@/lib/history/describe';
import { MOODS, SUGGESTED_TAGS, type JournalEntry, type JournalSummary } from '@/lib/journal/types';
import { MoodEmoji } from '@/components/journal/mood-emoji';
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

/** A day on the week bar: filled when written, faint while today is still open, empty when missed. */
function weekDayClass(day: string, written: Set<string>, todayKey: string) {
  if (written.has(day)) return 'on';
  return day === todayKey ? 'open' : undefined;
}

/** "#work #sleep". */
function hashtags(tags: string[]) {
  return tags.map((tag) => `#${tag}`).join(' ');
}

/** A tag tapped on comes off; a new one goes on, up to eight. */
function withTagToggled(current: string[], tag: string) {
  if (current.includes(tag)) return current.filter((item) => item !== tag);
  return current.length < 8 ? [...current, tag] : current;
}

/** The button under past entries: fewer, or how many there are to show. */
function pastToggleLabel(showAll: boolean, pastCount: number, loadedCount: number) {
  if (showAll) return 'Show fewer';
  // The journal loads the latest 60 entries, so a full page is only the latest.
  return loadedCount >= 60 ? `Latest ${pastCount} past entries` : `All ${pastCount} past entries`;
}

/** A day's initial, under its dot on the week strip. */
function initial(date: string) {
  return new Intl.DateTimeFormat('en-IN', { weekday: 'narrow', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
}

/**
 * The streak as one line and the last seven days as a strip of dots: filled
 * where there is an entry, hollow where a day was missed, and ringed for today
 * while it is still open.
 */
function StreakStrip({ journal, todayKey }: Readonly<{ journal: JournalSummary; todayKey: string }>) {
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
    <div className="pf-streak jr-streak">
      <p className="jr-streak-line">
        <Flame size={15} strokeWidth={2.2} aria-hidden="true" />
        <b>{journal.streak}</b> {journal.streak === 1 ? 'day in a row' : 'days in a row'}
        {count > 0 && <span className="jr-count">{countLabel}</span>}
      </p>
      {/* One image with one label: a list inside role="img" breaks list semantics, so the days are plain spans. */}
      <div className="jr-week" role="img" aria-label={`Last seven days: ${summary}.`}>
        {days.map((day) => <span key={day} className={weekDayClass(day, written, todayKey)}><i /><span>{initial(day)}</span></span>)}
      </div>
    </div>
  );
}

/** Past entries in groups a diary reads by: this week, last week, then by month. */
function groupByWeek(entries: JournalEntry[], todayKey: string) {
  const now = Date.parse(`${todayKey}T00:00:00Z`);
  const month = new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const groups: { label: string; entries: JournalEntry[] }[] = [];
  for (const entry of entries) {
    const ago = Math.round((now - Date.parse(`${entry.date}T00:00:00Z`)) / 86_400_000);
    let label = month.format(new Date(`${entry.date}T00:00:00Z`));
    if (ago < 7) label = 'This week';
    else if (ago < 14) label = 'Last week';
    const last = groups.at(-1);
    if (last?.label === label) last.entries.push(entry);
    else groups.push({ label, entries: [entry] });
  }
  return groups;
}

/** Long entries fold to a few lines in the timeline. */
const FOLD_AT = 240;

/** A version to bring back, saved as a new edit of that day. */
function restoreVersion(date: string, version: NonNullable<JournalRevision['previous']>) {
  return () => safeAction(saveJournalEntryAction)({ date, mood: version.mood, body: version.body, tags: version.tags });
}

function historyRows(items: JournalRevision[]): HistoryRow[] {
  return items.map((item) => ({
    id: item.id,
    createdAt: item.createdAt,
    line: journalRevisionLine(item),
    before: item.action === 'created' ? null : item.previous?.body || null,
    restore: item.previous ? restoreVersion(item.date, item.previous) : undefined,
    restoreLabel: item.action === 'deleted' ? 'Bring back' : 'Restore this version',
  }));
}

async function loadHistory(date: string) {
  const result = await safeAction(loadJournalHistoryAction)(date);
  return { success: result.success, message: result.message, rows: historyRows(result.items ?? []) };
}

async function loadDeleted() {
  const result = await safeAction(loadDeletedJournalAction)();
  return {
    success: result.success,
    message: result.message,
    rows: (result.items ?? []).map((item) => ({
      id: item.id,
      createdAt: item.createdAt,
      line: `${prettyDate(item.date)} · ${item.previous?.body.trim().slice(0, 80) || 'no text'}`,
      before: item.previous?.body || null,
      restore: item.previous ? restoreVersion(item.date, item.previous) : undefined,
      restoreLabel: 'Bring back',
    })),
  };
}

function Editor({ entry, date, onDone }: Readonly<{ entry: JournalEntry | null; date: string; onDone: () => void }>) {
  const router = useRouter();
  const [mood, setMood] = useState<number>(entry?.mood ?? 0);
  const [body, setBody] = useState(entry?.body ?? '');
  const [tags, setTags] = useState<string[]>(entry?.tags ?? []);
  const [message, setMessage] = useState<{ text: string; success: boolean } | null>(null);
  const [isPending, startTransition] = useTransition();
  const isToday = date === today();

  function toggleTag(tag: string) {
    setTags((current) => withTagToggled(current, tag));
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

  let submitLabel: ReactNode = entry ? 'Update entry' : 'Save entry';
  if (isPending) submitLabel = <><LoaderCircle className="workbook-spinner" size={14} aria-hidden="true" /> Saving…</>;

  return (
    <form className="fd-form pf-editor jr-editor" onSubmit={save}>
      <p className="pf-prompt jr-prompt">{isToday ? 'How are you feeling today?' : `How were you feeling on ${prettyDate(date)}?`}</p>
      <div className="pf-moods" role="radiogroup" aria-label="Mood">
        {MOODS.map((item) => (
          <button key={item.value} type="button" role="radio" aria-checked={mood === item.value} onClick={() => setMood(item.value)} disabled={isPending}>
            <MoodEmoji value={item.value} size={36} />{item.label}
          </button>
        ))}
      </div>
      <label className="sr-only" htmlFor={`journal-body-${date}`}>Journal entry</label>
      <textarea id={`journal-body-${date}`} className="pf-textarea jr-paper" value={body} onChange={(event) => setBody(event.currentTarget.value)} rows={8} maxLength={4000} placeholder="What happened, what you’re grateful for, what’s on your mind…" disabled={isPending} />
      <fieldset className="fd-chips pf-tags" aria-label="Tags">
        <div>
          {SUGGESTED_TAGS.map((tag) => (
            <button key={tag} type="button" aria-pressed={tags.includes(tag)} onClick={() => toggleTag(tag)} disabled={isPending}>#{tag}</button>
          ))}
        </div>
      </fieldset>
      <div className="fd-act pf-save jr-save">
        <span className="pf-count">{body.length}/4000</span>
        {entry && <button className="ghost" type="button" onClick={onDone} disabled={isPending}>Cancel</button>}
        <button type="submit" disabled={isPending}>{submitLabel}</button>
      </div>
      {message && <output className={`fd-msg ${message.success ? 'ok' : 'bad'}`}>{message.text}</output>}
    </form>
  );
}

export function Journal({ journal, notes }: Readonly<{ journal: JournalSummary; notes?: ReactNode }>) {
  const router = useRouter();
  const [editingDate, setEditingDate] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [historyDate, setHistoryDate] = useState<string | null>(null);
  const [showDeleted, setShowDeleted] = useState(false);
  const [opened, setOpened] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  // Days already written when the page opened stay still; one saved since enters (journal.css).
  const [seen] = useState(() => new Set(journal.entries.map((entry) => entry.date)));

  if (journal.state === 'setup') return <><FieldLabel>Journal</FieldLabel><p className="fd-msg bad">Journal isn’t set up yet. Apply the profile/journal migration in Supabase, then refresh.</p>{notes}</>;
  if (journal.state === 'unavailable') return <><FieldLabel>Journal</FieldLabel><p className="fd-msg bad">Journal could not be loaded. Refresh the app and try again.</p>{notes}</>;

  const todayKey = today();
  const todayEntry = journal.entries.find((entry) => entry.date === todayKey) ?? null;
  const past = journal.entries.filter((entry) => entry.date !== todayKey);
  const shown = showAll ? past : past.slice(0, PAST_PREVIEW);
  const moodOf = (value: number) => MOODS.find((item) => item.value === value)!;
  const voiceOf = (date: string) => (journal.voice ?? []).filter((note) => note.date === date);

  const toggleHistory = (date: string) => setHistoryDate(historyDate === date ? null : date);

  function remove(date: string) {
    if (!window.confirm(`Delete your journal entry for ${prettyDate(date)}? You can bring it back from Deleted entries.`)) return;
    startTransition(async () => {
      await safeAction(deleteJournalEntryAction)(date);
      router.refresh();
    });
  }

  const groups = groupByWeek(shown, todayKey);

  return (
    <div className="jr">
      <section className="pf-today jr-write" aria-label="Today’s entry">
        <header className="jr-write-head">
          <h2 className="jr-date"><span>{weekday(todayKey)}</span>{longDate(todayKey)}</h2>
          <StreakStrip journal={journal} todayKey={todayKey} />
        </header>
        {todayEntry && editingDate !== todayKey ? (
          <div className="pf-entry-view jr-today" data-new={!seen.has(todayKey) || undefined}>
            <p className="jr-feeling" data-mood={todayEntry.mood}><MoodEmoji value={todayEntry.mood} size={22} /> Feeling {moodOf(todayEntry.mood).label.toLowerCase()}</p>
            {todayEntry.body && <p className="fd-prose jr-prose">{todayEntry.body}</p>}
            {todayEntry.tags.length > 0 && <p className="pf-entry-tags">{hashtags(todayEntry.tags)}</p>}
            <div className="fd-act">
              <button className="ghost" type="button" onClick={() => setEditingDate(todayKey)}>Edit today’s entry</button>
              <button className="fd-link" type="button" aria-expanded={historyDate === todayKey} onClick={() => toggleHistory(todayKey)}>History</button>
            </div>
            {historyDate === todayKey && <HistoryPanel title="Changes to today’s entry" load={() => loadHistory(todayKey)} empty="No changes recorded yet." />}
          </div>
        ) : (
          <Editor key={todayKey} entry={todayEntry} date={todayKey} onDone={() => setEditingDate(null)} />
        )}
        <VoiceNotes date={todayKey} notes={voiceOf(todayKey)} />
      </section>

      <div className="jr-side">
        <section className="jr-past" aria-label="Past entries">
          <h2 className="jr-h">Past entries</h2>
          {past.length ? (
            <div className="pf-entries">
              {groups.map((group) => (
                <div key={group.label} className="jr-group">
                  <h3>{group.label}</h3>
                  <ol className="jr-timeline">
                    {group.entries.map((entry) => {
                      const long = entry.body.length > FOLD_AT;
                      const open = opened === entry.date;
                      return (
                        <li key={entry.date} className="pf-entry jr-entry" data-mood={entry.mood} data-new={!seen.has(entry.date) || undefined}>
                          {editingDate === entry.date ? (
                            <Editor entry={entry} date={entry.date} onDone={() => setEditingDate(null)} />
                          ) : (
                            <>
                              <div className="pf-entry-head jr-entry-head">
                                <span className="jr-dot" aria-hidden="true" />
                                <div>
                                  <strong>{prettyDate(entry.date)}</strong>
                                  <small><span className="pf-entry-mood" role="img" aria-label={moodOf(entry.mood).label}><MoodEmoji value={entry.mood} size={18} /></span> {moodOf(entry.mood).label}</small>
                                </div>
                                <button type="button" className="pf-delete" aria-label={`Delete entry for ${prettyDate(entry.date)}`} onClick={() => remove(entry.date)} disabled={isPending}><Trash2 size={14} aria-hidden="true" /></button>
                              </div>
                              {entry.body && <p className={`pf-entry-body jr-entry-body${long && !open ? ' folded' : ''}`}>{entry.body}</p>}
                              {entry.tags.length > 0 && <p className="jr-entry-tags">{hashtags(entry.tags)}</p>}
                              {voiceOf(entry.date).length > 0 && <VoiceNotes date={entry.date} notes={voiceOf(entry.date)} />}
                              <div className="hs-links jr-links">
                                {long && <button type="button" className="fd-link" aria-expanded={open} onClick={() => setOpened(open ? null : entry.date)}>{open ? 'Show less' : 'Read all'}</button>}
                                <button type="button" className="fd-link pf-edit" onClick={() => setEditingDate(entry.date)}>Edit</button>
                                <button type="button" className="fd-link pf-edit" aria-expanded={historyDate === entry.date} onClick={() => toggleHistory(entry.date)}>History</button>
                              </div>
                              {historyDate === entry.date && <HistoryPanel title={`Changes to ${prettyDate(entry.date)}`} load={() => loadHistory(entry.date)} empty="No changes recorded yet." />}
                            </>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                </div>
              ))}
              {past.length > PAST_PREVIEW && (
                <button type="button" className="fd-link pf-more" onClick={() => setShowAll(!showAll)} aria-expanded={showAll}>
                  {pastToggleLabel(showAll, past.length, journal.entries.length)}
                </button>
              )}
            </div>
          ) : <p className="fd-empty jr-empty">Your past entries will show up here, one day at a time.</p>}
        </section>

        {notes}

        <footer className="jr-foot">
          <button type="button" className="fd-link pf-more" aria-expanded={showDeleted} onClick={() => setShowDeleted(!showDeleted)}>{showDeleted ? 'Hide deleted entries' : 'Deleted entries'}</button>
          {showDeleted && <HistoryPanel title="Deleted entries" load={loadDeleted} empty="Nothing deleted. Entries you delete wait here." />}
          <p className="fd-note">Entries and voice notes stay private to your account. Orbis doesn’t use them for advice or notifications; Ask reads them only when you ask a question with Journal ticked.</p>
        </footer>
      </div>
    </div>
  );
}
