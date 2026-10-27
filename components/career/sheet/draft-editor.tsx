'use client';

import { useId, useState } from 'react';
import { Save } from 'lucide-react';
import { updateDraftAction } from '@/app/career/actions';
import { BusyIcon, NoticeLine } from '@/components/career/bits';
import { ownerNumbers, splitMarks } from '@/components/career/format';
import { useRun } from '@/components/career/use-run';
import type { CareerApplication, CareerProfile, ScreeningAnswer } from '@/lib/career/types';
import type { ApplicationDetail } from '@/lib/career/view';

/** The numbers the owner typed, highlighted in place, with a plain word about why. */
function TypedNumbers({ text, marks }: Readonly<{ text: string; marks: string[] }>) {
  if (!marks.length) return null;
  return (
    <div className="cr-typed">
      <p>
        <b>{marks.length === 1 ? 'A number you typed' : 'Numbers you typed'}</b>
        {' '}isn’t in your profile, so it goes out exactly as you wrote it. Check it before you send.
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

/**
 * The cover note and screening answers, editable while the application hasn't
 * gone. Saving re-runs the truth check on the server; any number that is
 * neither in the profile nor in what Orbis wrote is the owner's, and is
 * highlighted rather than removed.
 */
export function DraftEditor({ application, profile, original, onDetail }: Readonly<{
  application: CareerApplication;
  profile: CareerProfile | null;
  /** What Orbis wrote when the sheet opened, so its own numbers aren't flagged as typed. */
  original: { coverNote: string; answers: string[] };
  onDetail: (detail: ApplicationDetail) => void;
}>) {
  const noteId = useId();
  const [note, setNote] = useState(application.coverNote?.text ?? '');
  const [answers, setAnswers] = useState<ScreeningAnswer[]>(application.answers);
  const { busy, notice, run } = useRun();
  const editable = application.status === 'ready' || application.status === 'failed' || application.status === 'drafting';
  const savedNote = application.coverNote?.text ?? '';
  const dirty = note !== savedNote || answers.some((answer, index) => answer.answer !== application.answers[index]?.answer);

  const factTexts = (profile?.facts ?? []).map((fact) => fact.text);
  const knownForNote = [...factTexts, original.coverNote];
  const noteMarks = ownerNumbers(savedNote, knownForNote);

  const save = () => run('save', () => updateDraftAction(application.id, { coverNote: note, answers }), (detail) => {
    onDetail(detail);
    setNote(detail.application?.coverNote?.text ?? note);
    setAnswers(detail.application?.answers ?? answers);
    return 'Saved and checked.';
  });

  return (
    <section className="cr-block" aria-labelledby="cr-note-title">
      <h2 className="fd-label" id="cr-note-title">Cover note and answers</h2>
      {!editable && <p className="cr-block-note">These went out with the application, so they can’t be changed now.</p>}
      <label className="fd-field" htmlFor={noteId}>
        Cover note
        <textarea id={noteId} rows={8} value={note} disabled={!editable} onChange={(event) => setNote(event.currentTarget.value)} />
      </label>
      <p className="fd-count">{note.split(/\s+/).filter(Boolean).length} / 180 words</p>
      <TypedNumbers text={savedNote} marks={noteMarks} />

      {answers.map((answer, index) => (
        <AnswerField
          key={answer.question}
          answer={answer}
          disabled={!editable}
          marks={ownerNumbers(application.answers[index]?.answer ?? '', [...factTexts, original.answers[index] ?? ''])}
          onChange={(text) => setAnswers((current) => current.map((item, at) => (at === index ? { ...item, answer: text } : item)))}
        />
      ))}

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
