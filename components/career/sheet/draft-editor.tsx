'use client';

import { useId, useState } from 'react';
import { Save } from 'lucide-react';
import { updateDraftAction } from '@/app/career/actions';
import { BusyIcon, NoticeLine } from '@/components/career/bits';
import { ownerNumbers, splitMarks } from '@/components/career/format';
import { useRun } from '@/components/career/use-run';
import type { ApplicationStatus, CareerApplication, CareerProfile, ScreeningAnswer, TruthRemoval } from '@/lib/career/types';
import type { ApplicationDetail } from '@/lib/career/view';

// What updateDraftAction accepts edits in (app/career/actions.ts EDITABLE).
const EDITABLE: readonly ApplicationStatus[] = ['ready', 'opened', 'failed'];

const flat = (text: string) => text.replaceAll(/\s+/g, ' ').trim();

// The truth check names each place it read (lib/career/truth.ts).
const notePlace = 'cover note';
const answerPlace = (question: string) => `answer: ${question.trim()}`;

/** "cover note" → "Cover note", "answer: Notice period?" → "Notice period?". */
function placeLabel(where: string) {
  if (where.startsWith('answer: ')) return where.slice('answer: '.length);
  return where.charAt(0).toUpperCase() + where.slice(1);
}

/**
 * Before a save: the numbers just typed that neither the profile nor the
 * saved text has, highlighted in place. Saving runs the real check, whose
 * list (below the fields) replaces this hint.
 */
function TypedNumbers({ text, marks }: Readonly<{ text: string; marks: string[] }>) {
  if (!marks.length) return null;
  return (
    <div className="cr-typed">
      <p>
        <b>{marks.length === 1 ? 'A number you typed' : 'Numbers you typed'}</b>
        {' '}isn’t in your profile. It goes out exactly as you wrote it; saving checks the rest.
      </p>
      <p className="cr-typed-text">
        {/* The parts are a fixed split of one string, so their position is their identity. */}
        {splitMarks(text, marks).map((part, index) => (part.mark
          ? <mark key={`${index}:${part.text}`}>{part.text}</mark>
          : <span key={`${index}:${part.text}`}>{part.text}</span>))}
      </p>
    </div>
  );
}

/** The server's word on the owner's own text: kept as written, but worth a second look. */
function CheckList({ highlights }: Readonly<{ highlights: TruthRemoval[] }>) {
  if (!highlights.length) return null;
  return (
    <div className="cr-check-these" role="note" aria-labelledby="cr-check-these-title">
      <p id="cr-check-these-title"><b>Check before sending:</b> a recruiter may ask about these.</p>
      <ul>
        {highlights.map((item) => (
          <li key={`${item.where}\n${item.text}`}>
            <small>{placeLabel(item.where)}</small>
            <mark>{item.text}</mark>
            <span>{item.reason.charAt(0).toUpperCase() + item.reason.slice(1)}. It stays as you wrote it.</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AnswerField({ answer, onChange, disabled, marks }: Readonly<{ answer: ScreeningAnswer; onChange: (text: string) => void; disabled: boolean; marks: string[] }>) {
  const id = useId();
  return (
    <div className="cr-answer">
      <label className="fd-field" htmlFor={id}>
        {answer.question}
        <textarea id={id} rows={3} value={answer.answer} disabled={disabled} onChange={(event) => onChange(event.currentTarget.value)} />
      </label>
      <TypedNumbers text={answer.answer} marks={marks} />
    </div>
  );
}

/** The places this save changes, as the truth check names them. */
function changedPlaces(note: string, savedNote: string, answers: ScreeningAnswer[], saved: ScreeningAnswer[]): string[] {
  const places = flat(note) === flat(savedNote) ? [] : [notePlace];
  answers.forEach((answer, index) => {
    if (flat(answer.answer) !== flat(saved[index]?.answer ?? '')) places.push(answerPlace(answer.question));
  });
  return places;
}

/**
 * The cover note and screening answers, editable until the application has
 * gone (ready, waiting on "I applied", or failed). Saving re-runs the truth
 * check on the server: the owner's own words are never removed, and whatever
 * in them the profile can't back up comes back as a list to check before
 * sending. Before a save, numbers just typed are highlighted as a hint.
 */
export function DraftEditor({ application, profile, original, highlights: arrived, onDetail }: Readonly<{
  application: CareerApplication;
  profile: CareerProfile | null;
  /** What Orbis wrote when the sheet opened, so its own numbers aren't flagged as typed. */
  original: { coverNote: string; answers: string[] };
  /** Highlights the detail arrived with (a detail from updateDraftAction carries them). */
  highlights?: TruthRemoval[];
  onDetail: (detail: ApplicationDetail) => void;
}>) {
  const noteId = useId();
  const [note, setNote] = useState(application.coverNote?.text ?? '');
  const [answers, setAnswers] = useState<ScreeningAnswer[]>(application.answers);
  // The server's highlights from this sitting's saves. Not stored, so they last while the sheet is open.
  const [highlights, setHighlights] = useState<TruthRemoval[]>(arrived ?? []);
  const { busy, notice, run } = useRun();
  const editable = EDITABLE.includes(application.status);
  const savedNote = application.coverNote?.text ?? '';
  const noteDirty = note !== savedNote;
  const dirty = noteDirty || answers.some((answer, index) => answer.answer !== application.answers[index]?.answer);

  const factTexts = (profile?.facts ?? []).map((fact) => fact.text);
  const noteMarks = noteDirty ? ownerNumbers(note, [...factTexts, original.coverNote, savedNote]) : [];
  const answerMarks = (answer: ScreeningAnswer, index: number) => {
    const saved = application.answers[index]?.answer ?? '';
    return answer.answer === saved ? [] : ownerNumbers(answer.answer, [...factTexts, original.answers[index] ?? '', saved]);
  };

  const save = () => {
    const places = changedPlaces(note, savedNote, answers, application.answers);
    return run('save', () => updateDraftAction(application.id, { coverNote: note, answers }), (detail) => {
      onDetail(detail);
      setNote(detail.application?.coverNote?.text ?? note);
      setAnswers(detail.application?.answers ?? answers);
      // What was just saved was checked again; what wasn't keeps its earlier word.
      const fresh = detail.highlights ?? [];
      setHighlights((current) => [...current.filter((item) => !places.includes(item.where)), ...fresh]);
      return fresh.length ? 'Saved. Check the highlighted lines before you send.' : 'Saved and checked.';
    });
  };

  return (
    <section className="cr-block" aria-labelledby="cr-note-title">
      <h2 className="fd-label" id="cr-note-title">Cover note and answers</h2>
      {!editable && <p className="cr-block-note">These went out with the application, so they can’t be changed now.</p>}
      <label className="fd-field" htmlFor={noteId}>
        Cover note
        <textarea id={noteId} rows={8} value={note} disabled={!editable} onChange={(event) => setNote(event.currentTarget.value)} />
      </label>
      <p className="fd-count">{note.split(/\s+/).filter(Boolean).length} / 180 words</p>
      <TypedNumbers text={note} marks={noteMarks} />

      {answers.map((answer, index) => (
        <AnswerField
          key={answer.question}
          answer={answer}
          disabled={!editable}
          marks={answerMarks(answer, index)}
          onChange={(text) => setAnswers((current) => current.map((item, at) => (at === index ? { ...item, answer: text } : item)))}
        />
      ))}

      {editable && <CheckList highlights={highlights} />}

      {editable && (
        <div className="fd-act pf-act">
          <button type="button" onClick={save} disabled={!dirty || busy !== null}>
            <BusyIcon on={busy === 'save'}><Save size={14} aria-hidden="true" /></BusyIcon>
            Save changes
          </button>
          {dirty && <button type="button" className="fd-link" onClick={() => { setNote(savedNote); setAnswers(application.answers); }}>Undo changes</button>}
        </div>
      )}
      <NoticeLine notice={notice} />
    </section>
  );
}
