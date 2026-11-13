'use client';

import { useMemo, useState } from 'react';
import { Clapperboard, LoaderCircle, MessageSquareText, Plus, Trash2 } from 'lucide-react';
import { approvePlanAction, cancelJobAction, requestPlanChangesAction } from '@/app/shorts/actions';
import { safeAction } from '@/lib/client/safe-action';
import { parseCaps, PLAN_LIMITS, validatePlan, wordCount, type PlanLine, type ShortPlan } from '@/lib/shorts/plan';
import { LIMITS } from '@/lib/shorts/rules';
import type { ShortJob } from '@/lib/shorts/types';

/** The caption chunks as they'll look: the *word in yellow. */
function CapsPreview({ caps }: Readonly<{ caps: string }>) {
  const chunks = parseCaps(caps);
  if (!chunks.length) return null;
  return (
    <span className="sh-caps" aria-hidden="true">
      {chunks.map((chunk, index) => (
        <span key={index} className="sh-cap">
          {chunk.words.map((word, at) => <span key={at} className={at === chunk.keyword ? 'is-key' : undefined}>{word.replace(/^\*/, '')} </span>)}
        </span>
      ))}
    </span>
  );
}

/**
 * The plan the worker wrote, editable line by line before anything renders:
 * narration, caption chunks (one *yellow word each) and the shot. Build stays
 * off until the plan passes the same checks the server and the worker use.
 */
export function PlanEditor({ job, onChanged }: Readonly<{ job: ShortJob & { plan: ShortPlan }; onChanged: (job: ShortJob | null, message?: string) => void }>) {
  const [plan, setPlan] = useState<ShortPlan>(job.plan);
  const [feedback, setFeedback] = useState('');
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState<'build' | 'changes' | 'discard' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const checked = useMemo(() => validatePlan(plan), [plan]);
  const errors = checked.ok ? [] : checked.errors;
  const words = wordCount(plan);
  const pace = words / Math.max(1, plan.seconds);

  const setLine = (index: number, patch: Partial<PlanLine>) => setPlan((current) => ({ ...current, lines: current.lines.map((line, at) => (at === index ? { ...line, ...patch } : line)) }));
  const removeLine = (index: number) => setPlan((current) => ({ ...current, lines: current.lines.filter((_, at) => at !== index) }));
  const addLine = (index: number) => setPlan((current) => ({ ...current, lines: [...current.lines.slice(0, index + 1), { text: '', caps: '', shot: '' }, ...current.lines.slice(index + 1)] }));

  async function act(kind: 'build' | 'changes' | 'discard') {
    setBusy(kind);
    setMessage(null);
    const result = kind === 'build'
      ? await safeAction(approvePlanAction)(job.id, plan)
      : kind === 'changes'
        ? await safeAction(requestPlanChangesAction)(job.id, feedback)
        : await safeAction(cancelJobAction)(job.id);
    setBusy(null);
    if (!result.success) return setMessage(result.message);
    onChanged(result.data, kind === 'build' ? 'Approved. Your Shorts PC is building the video.' : kind === 'changes' ? 'Sent back to your Shorts PC for a new plan.' : 'Discarded.');
  }

  return (
    <section className="sh-plan" aria-label="The plan">
      <label className="fd-field">
        Title
        <input value={plan.title} maxLength={PLAN_LIMITS.title} onChange={(event) => setPlan({ ...plan, title: event.currentTarget.value })} />
      </label>
      <p className={`sh-pace${pace > 3.6 || pace < 2.2 ? ' is-off' : ''}`}>
        {words} words for about {plan.seconds} s ({pace.toFixed(1)} words a second{pace > 3.6 ? ', a bit fast' : pace < 2.2 ? ', a bit slow' : ''})
      </p>

      <ol className="sh-lines">
        {plan.lines.map((line, index) => {
          const lineErrors = errors.filter((error) => error.startsWith(`Line ${index + 1} `) || error.startsWith(`Line ${index + 1},`) || error.startsWith(`Line ${index + 1}’`));
          return (
            <li key={index} className={`sh-line${lineErrors.length ? ' has-error' : ''}`}>
              <span className="sh-line-n" aria-hidden="true">{index + 1}</span>
              <div className="sh-line-fields">
                <label className="fd-field">
                  Narration
                  <textarea rows={2} value={line.text} maxLength={PLAN_LIMITS.text} onChange={(event) => setLine(index, { text: event.currentTarget.value })} />
                </label>
                <label className="fd-field">
                  Captions <span className="sh-optional">1–3 words per chunk, split with |, one *yellow word each</span>
                  <input value={line.caps} maxLength={PLAN_LIMITS.caps} spellCheck={false} onChange={(event) => setLine(index, { caps: event.currentTarget.value })} />
                </label>
                <CapsPreview caps={line.caps} />
                <label className="fd-field">
                  <span className="sh-shot-label"><Clapperboard size={12} aria-hidden="true" /> Shot</span>
                  <input value={line.shot} maxLength={PLAN_LIMITS.shot} onChange={(event) => setLine(index, { shot: event.currentTarget.value })} />
                </label>
                {lineErrors.map((error) => <p key={error} className="sh-line-error">{error}</p>)}
              </div>
              <div className="sh-line-tools">
                <button type="button" className="sh-icon" onClick={() => addLine(index)} disabled={plan.lines.length >= PLAN_LIMITS.linesMax} aria-label={`Add a line after line ${index + 1}`}><Plus size={15} aria-hidden="true" /></button>
                <button type="button" className="sh-icon" onClick={() => removeLine(index)} disabled={plan.lines.length <= PLAN_LIMITS.linesMin} aria-label={`Remove line ${index + 1}`}><Trash2 size={15} aria-hidden="true" /></button>
              </div>
            </li>
          );
        })}
      </ol>

      {errors.filter((error) => !error.startsWith('Line ')).map((error) => <p key={error} className="fd-msg bad">{error}</p>)}

      {plan.sources.length > 0 && (
        <details className="sh-sources">
          <summary>Sources ({plan.sources.length})</summary>
          <ul>{plan.sources.map((source) => <li key={source}>{source}</li>)}</ul>
        </details>
      )}
      {plan.notes && <p className="fd-note">{plan.notes}</p>}

      {message && <p className="fd-msg bad" role="alert">{message}</p>}

      {asking ? (
        <div className="sh-ask">
          <label className="fd-field">
            What should change?
            <textarea rows={3} value={feedback} maxLength={LIMITS.feedback} placeholder="Make the hook punchier and end on the myth." onChange={(event) => setFeedback(event.currentTarget.value)} />
          </label>
          <div className="sh-actions">
            <button type="button" className="so-action primary" onClick={() => void act('changes')} disabled={busy !== null || !feedback.trim()}>
              {busy === 'changes' ? <LoaderCircle className="workbook-spinner" size={16} aria-hidden="true" /> : <MessageSquareText size={16} aria-hidden="true" />}
              <span>Send for a new plan</span>
            </button>
            <button type="button" className="fd-link" onClick={() => setAsking(false)}>Back to editing</button>
          </div>
        </div>
      ) : (
        <div className="sh-actions">
          <button type="button" className="so-action primary" onClick={() => void act('build')} disabled={busy !== null || !checked.ok}>
            {busy === 'build' ? <LoaderCircle className="workbook-spinner" size={16} aria-hidden="true" /> : <Clapperboard size={16} aria-hidden="true" />}
            <span>Build video</span>
          </button>
          <button type="button" className="so-action" onClick={() => setAsking(true)} disabled={busy !== null}>
            <MessageSquareText size={15} aria-hidden="true" />
            <span>Ask for changes</span>
          </button>
          <button type="button" className="fd-link alert" onClick={() => void act('discard')} disabled={busy !== null}>Discard</button>
        </div>
      )}
    </section>
  );
}
