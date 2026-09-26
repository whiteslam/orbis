'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, ChevronLeft, LoaderCircle, Sparkles, Trash2 } from 'lucide-react';
import { deleteHealthPlanAction, generateHealthPlanAction, startHealthPlanAction } from '@/app/health/library-actions';
import { PlanView } from '@/components/health/plan-view';
import type { HealthPlan, HealthPlanRecord, PlanQuestion } from '@/lib/health-docs/types';
import { FieldSubHead, useScrollTop } from '@/components/field/field';
import { safeAction } from '@/lib/client/safe-action';

const MIN_ANSWERS = 10;
// A long interview opens on its first few questions; the rest are one tap away.
const FIRST_QUESTIONS = 5;

type Stage =
  | { kind: 'idle' }
  | { kind: 'questions'; questions: PlanQuestion[] }
  | { kind: 'plan'; plan: HealthPlan };

/**
 * Where a plan stands, counted from the day it was written. Plans have no
 * separate start date, so creation is the only honest anchor.
 */
export function planWeek(record: HealthPlanRecord) {
  const total = Math.max(1, record.plan.durationWeeks);
  const elapsed = Math.floor((Date.now() - new Date(record.createdAt).getTime()) / (7 * 86_400_000)) + 1;
  return { week: Math.min(Math.max(elapsed, 1), total), total, done: elapsed > total };
}

function planDate(value: string) {
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(value));
}

function QuestionField({ question, value, onChange, disabled }: { question: PlanQuestion; value: string; onChange: (value: string) => void; disabled: boolean }) {
  if (question.kind === 'single' || question.kind === 'multi') {
    const selected = value ? value.split(' | ') : [];
    const toggle = (option: string) => {
      if (question.kind === 'single') return onChange(selected[0] === option ? '' : option);
      onChange((selected.includes(option) ? selected.filter((item) => item !== option) : [...selected, option]).join(' | '));
    };
    return (
      <div className="hl-q-options" role="group" aria-label={question.question}>
        {question.options.map((option) => (
          <button key={option} type="button" aria-pressed={selected.includes(option)} onClick={() => toggle(option)} disabled={disabled}>{option}</button>
        ))}
      </div>
    );
  }
  return (
    <div className="hl-q-free">
      <input type={question.kind === 'number' ? 'number' : 'text'} inputMode={question.kind === 'number' ? 'decimal' : undefined} value={value} maxLength={500} onChange={(event) => onChange(event.currentTarget.value)} placeholder={question.kind === 'number' ? 'Enter a number' : 'Type your answer'} disabled={disabled} aria-label={question.question} />
      {question.unit && <span>{question.unit}</span>}
    </div>
  );
}

function BackLink({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return <button type="button" className="hl-back" onClick={onClick} disabled={disabled}><ChevronLeft size={14} strokeWidth={2.2} aria-hidden="true" /> All plans</button>;
}

/**
 * Plans, as a set of views inside Health: the list of saved plans (with the
 * way to start a new one), the interview, and a plan itself. `initialPlanId`
 * opens one plan directly from the Health tab.
 */
export function PlanBuilder({ plans, state = 'ready', initialPlanId = null, onBack }: { plans: HealthPlanRecord[]; state?: 'ready' | 'setup' | 'unavailable'; initialPlanId?: string | null; onBack: () => void }) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>({ kind: 'idle' });
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [openPlanId, setOpenPlanId] = useState<string | null>(initialPlanId);
  const [showAll, setShowAll] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [working, setWorking] = useState<'questions' | 'plan' | null>(null);
  const [isPending, startTransition] = useTransition();
  const top = useScrollTop(`${stage.kind}-${openPlanId ?? ''}`);

  function start() {
    setMessage(null);
    setWorking('questions');
    startTransition(async () => {
      const result = await safeAction(startHealthPlanAction)();
      setWorking(null);
      if (!result.success) return setMessage(result.message);
      setAnswers({});
      setShowAll(false);
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

  function allPlans() {
    setMessage(null);
    setOpenPlanId(null);
    setStage({ kind: 'idle' });
  }

  const openPlan = plans.find((plan) => plan.id === openPlanId);

  if (stage.kind === 'questions') {
    const total = stage.questions.length;
    const answered = stage.questions.filter((question) => answers[question.id]?.trim()).length;
    const needed = Math.min(MIN_ANSWERS, total);
    const ready = answered >= needed;
    const collapsed = !showAll && total > FIRST_QUESTIONS + 1;
    const visible = collapsed ? stage.questions.slice(0, FIRST_QUESTIONS) : stage.questions;
    return (
      <>
        <span ref={top} hidden />
        <BackLink onClick={allPlans} disabled={isPending} />
        <header className="fd-sub-head hl-plan-head">
          <h1>A few questions first</h1>
          <p className="fd-lead">Orbis has already read your documents and steps. These fill the gaps it cannot infer.</p>
        </header>
        <div className="hl-bar big" role="progressbar" aria-label="Questions answered" aria-valuemin={0} aria-valuemax={total} aria-valuenow={answered}><i style={{ width: `${(answered / total) * 100}%` }} /></div>
        <p className="hl-bar-note"><b>{answered} of {total}</b> answered · at least {needed} to build your plan</p>

        <ol className="hl-questions">
          {visible.map((question, index) => {
            const done = Boolean(answers[question.id]?.trim());
            return (
              <li key={question.id} className={done ? 'done' : ''}>
                <i aria-hidden="true">{done ? <Check size={12} strokeWidth={3} /> : index + 1}</i>
                <div>
                  <strong>{question.question}</strong>
                  {question.why && <small>{question.why}</small>}
                  <QuestionField question={question} value={answers[question.id] ?? ''} onChange={(value) => setAnswers((current) => ({ ...current, [question.id]: value }))} disabled={isPending} />
                </div>
              </li>
            );
          })}
        </ol>
        {collapsed && <button className="fd-link hl-more" type="button" onClick={() => setShowAll(true)}>{total - FIRST_QUESTIONS} more questions</button>}

        {message && <p className="fd-msg bad" role="status">{message}</p>}
        <div className="fd-act hl-generate">
          <button type="button" onClick={() => generate(stage.questions)} disabled={!ready || isPending}>
            {working === 'plan' ? <><LoaderCircle className="workbook-spinner" size={14} aria-hidden="true" /> Writing your plan…</> : <><Sparkles size={14} aria-hidden="true" /> Generate my plan</>}
          </button>
        </div>
        <p className="fd-note tight">Writing a plan takes up to a minute. It reads your pinned documents and the passages that match, your steps and profile, and these answers.</p>
      </>
    );
  }

  if (stage.kind === 'plan' || openPlan) {
    return (
      <>
        <span ref={top} hidden />
        <BackLink onClick={allPlans} />
        <PlanView plan={stage.kind === 'plan' ? stage.plan : openPlan!.plan} />
      </>
    );
  }

  return (
    <>
      <span ref={top} hidden />
      <FieldSubHead crumb="Health · plans" title="Plans" lead="Orbis reads your saved documents, steps and profile, asks you at least 10 questions, then writes a workout, nutrition, targets and sleep plan." onBack={onBack} backLabel="Back to Health" />

      {state === 'setup' ? (
        <p className="fd-msg bad">Apply the health documents migration in Supabase to build and save plans.</p>
      ) : (
        <div className="fd-act">
          <button type="button" onClick={start} disabled={isPending}>
            {working === 'questions' ? <><LoaderCircle className="workbook-spinner" size={14} aria-hidden="true" /> Reading your data…</> : <><Sparkles size={14} aria-hidden="true" /> Build a new plan</>}
          </button>
        </div>
      )}
      {message && <p className="fd-msg bad" role="status">{message}</p>}

      {plans.length > 0 && (
        <section className="fd-quiet">
          <h2>Saved</h2>
          {plans.map((plan) => {
            const { week, total, done } = planWeek(plan);
            return (
              <div className="hl-plan-row" key={plan.id}>
                <button type="button" onClick={() => { setMessage(null); setOpenPlanId(plan.id); }}>
                  <span className="hl-row-top"><strong>{plan.title}</strong><small>{done ? `${total} weeks · done` : `week ${week} of ${total}`}</small></span>
                  <span className="hl-bar" aria-hidden="true"><i style={{ width: `${done ? 100 : (week / total) * 100}%` }} /></span>
                  <small className="hl-row-meta">Written {planDate(plan.createdAt)}</small>
                </button>
                <button type="button" className="fd-round hl-danger" onClick={() => remove(plan)} disabled={isPending} aria-label={`Delete ${plan.title}`}><Trash2 size={14} aria-hidden="true" /></button>
              </div>
            );
          })}
        </section>
      )}
      <p className="fd-note">Plans are general guidance, not medical advice.</p>
    </>
  );
}
