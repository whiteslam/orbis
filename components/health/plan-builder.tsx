'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, LoaderCircle, Sparkles, Trash2 } from 'lucide-react';
import { deleteHealthPlanAction, generateHealthPlanAction, startHealthPlanAction } from '@/app/health/library-actions';
import { PlanView } from '@/components/health/plan-view';
import type { HealthPlan, HealthPlanRecord, PlanQuestion } from '@/lib/health-docs/types';
import { safeAction } from '@/lib/client/safe-action';

const MIN_ANSWERS = 10;

type Stage =
  | { kind: 'idle' }
  | { kind: 'questions'; questions: PlanQuestion[] }
  | { kind: 'plan'; plan: HealthPlan };

function QuestionField({ question, value, onChange, disabled }: { question: PlanQuestion; value: string; onChange: (value: string) => void; disabled: boolean }) {
  if (question.kind === 'single' || question.kind === 'multi') {
    const selected = value ? value.split(' | ') : [];
    const toggle = (option: string) => {
      if (question.kind === 'single') return onChange(selected[0] === option ? '' : option);
      onChange((selected.includes(option) ? selected.filter((item) => item !== option) : [...selected, option]).join(' | '));
    };
    return (
      <div className="plan-options" role={question.kind === 'single' ? 'radiogroup' : 'group'} aria-label={question.question}>
        {question.options.map((option) => (
          <button key={option} type="button" aria-pressed={selected.includes(option)} className={selected.includes(option) ? 'active' : ''} onClick={() => toggle(option)} disabled={disabled}>{option}</button>
        ))}
      </div>
    );
  }
  return (
    <div className="plan-free">
      <input type={question.kind === 'number' ? 'number' : 'text'} inputMode={question.kind === 'number' ? 'decimal' : undefined} value={value} maxLength={500} onChange={(event) => onChange(event.currentTarget.value)} placeholder={question.kind === 'number' ? 'Enter a number' : 'Type your answer'} disabled={disabled} aria-label={question.question} />
      {question.unit && <span>{question.unit}</span>}
    </div>
  );
}

export function PlanBuilder({ plans, state = 'ready' }: { plans: HealthPlanRecord[]; state?: 'ready' | 'setup' | 'unavailable' }) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>({ kind: 'idle' });
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [openPlanId, setOpenPlanId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [working, setWorking] = useState<'questions' | 'plan' | null>(null);
  const [isPending, startTransition] = useTransition();

  function start() {
    setMessage(null);
    setWorking('questions');
    startTransition(async () => {
      const result = await safeAction(startHealthPlanAction)();
      setWorking(null);
      if (!result.success) return setMessage(result.message);
      setAnswers({});
      setStage({ kind: 'questions', questions: result.data });
    });
  }

  function generate(questions: PlanQuestion[]) {
    setMessage(null);
    setWorking('plan');
    startTransition(async () => {
      const payload = questions.filter((question) => answers[question.id]?.trim()).map((question) => ({ id: question.id, question: question.question, answer: answers[question.id].trim() }));
      const result = await safeAction(generateHealthPlanAction)({ answers: payload });
      setWorking(null);
      if (!result.success) return setMessage(result.message);
      setStage({ kind: 'plan', plan: result.data.plan });
      router.refresh();
    });
  }

  function remove(plan: HealthPlanRecord) {
    if (!window.confirm(`Delete “${plan.title}”?`)) return;
    startTransition(async () => {
      const result = await safeAction(deleteHealthPlanAction)(plan.id);
      if (!result.success) setMessage(result.message);
      else router.refresh();
    });
  }

  const openPlan = plans.find((plan) => plan.id === openPlanId);

  // Without the plans table nothing can be saved, so don't spend AI requests.
  if (state === 'setup') return <p className="finance-notice error">Apply the health documents migration in Supabase to build and save plans.</p>;

  if (stage.kind === 'questions') {
    const answered = stage.questions.filter((question) => answers[question.id]?.trim()).length;
    const ready = answered >= Math.min(MIN_ANSWERS, stage.questions.length);
    return (
      <section className="plan-builder">
        <button type="button" className="plan-back" onClick={() => setStage({ kind: 'idle' })} disabled={isPending}><ChevronLeft size={14} /> Back</button>
        <div className="plan-progress" aria-label={`${answered} of ${stage.questions.length} answered`}><i style={{ width: `${(answered / stage.questions.length) * 100}%` }} /></div>
        <p className="plan-note">{answered}/{stage.questions.length} answered · answer at least {Math.min(MIN_ANSWERS, stage.questions.length)} to build your plan.</p>
        <ol className="plan-questions">
          {stage.questions.map((question) => (
            <li key={question.id} className={answers[question.id]?.trim() ? 'done' : ''}>
              <strong>{question.question}</strong>
              {question.why && <small>{question.why}</small>}
              <QuestionField question={question} value={answers[question.id] ?? ''} onChange={(value) => setAnswers((current) => ({ ...current, [question.id]: value }))} disabled={isPending} />
            </li>
          ))}
        </ol>
        {message && <p className="finance-notice error" role="status">{message}</p>}
        <button className="finance-button primary plan-generate" type="button" onClick={() => generate(stage.questions)} disabled={!ready || isPending}>
          {working === 'plan' ? <><LoaderCircle className="workbook-spinner" size={15} /> Writing your plan… (up to a minute)</> : <><Sparkles size={15} /> Generate my plan</>}
        </button>
      </section>
    );
  }

  if (stage.kind === 'plan') {
    return (
      <section className="plan-builder">
        <button type="button" className="plan-back" onClick={() => setStage({ kind: 'idle' })}><ChevronLeft size={14} /> All plans</button>
        <PlanView plan={stage.plan} />
      </section>
    );
  }

  if (openPlan) {
    return (
      <section className="plan-builder">
        <button type="button" className="plan-back" onClick={() => setOpenPlanId(null)}><ChevronLeft size={14} /> All plans</button>
        <PlanView plan={openPlan.plan} />
      </section>
    );
  }

  return (
    <section className="plan-builder">
      <div className="plan-start">
        <div className="plan-start-icon"><Sparkles size={20} aria-hidden="true" /></div>
        <div>
          <strong>Build my health plan</strong>
          <p>Orbis reads your saved documents, steps, goals and profile, asks you at least 10 questions, then writes a workout, nutrition, targets and sleep plan.</p>
        </div>
      </div>
      <button className="finance-button primary plan-generate" type="button" onClick={start} disabled={isPending}>
        {working === 'questions' ? <><LoaderCircle className="workbook-spinner" size={15} /> Reading your data…</> : <><Sparkles size={15} /> Start</>}
      </button>
      {message && <p className="finance-notice error" role="status">{message}</p>}

      {plans.length > 0 && (
        <ul className="plan-saved">
          {plans.map((plan) => (
            <li key={plan.id}>
              <button type="button" onClick={() => setOpenPlanId(plan.id)}>
                <strong>{plan.title}</strong>
                <small>{plan.plan.durationWeeks} weeks · {new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(plan.createdAt))}</small>
              </button>
              <button type="button" className="workbook-icon-button" onClick={() => remove(plan)} disabled={isPending} aria-label={`Delete ${plan.title}`}><Trash2 size={14} /></button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
