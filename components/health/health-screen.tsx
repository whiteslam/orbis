'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { FileSpreadsheet, FileText, Plus } from 'lucide-react';
import { FieldHead, FieldSubHead, useScrollTop } from '@/components/field/field';
import { FitnessPersonaEditor } from '@/components/health/fitness-persona';
import { PartLoading } from '@/components/shell/loading';
import { adviceFromSaved, savedWhen, splitSummary, type ShownAdvice } from '@/lib/workbook/shown-advice';
import { documentAdded } from '@/lib/health-docs/format';
import { planWeek } from '@/lib/health/plan-week';
import type { LibraryState } from '@/lib/health-docs/repository';
import type { StepsSummary } from '@/lib/health/types';
import type { HealthPlanRecord, WorkoutDay } from '@/lib/health-docs/types';
import type { SavedWorkbookAdvice } from '@/lib/ai/saved';
import type { FitnessPersonaSummary } from '@/lib/personal/repository';
import type { HeadsupAction } from '@/lib/headsups/types';

const StepsCard = dynamic(() => import('@/components/health/steps-card').then((m) => m.StepsCard), { loading: PartLoading });
const PlanBuilder = dynamic(() => import('@/components/health/plan-builder').then((m) => m.PlanBuilder), { loading: PartLoading });
const HealthLibrary = dynamic(() => import('@/components/health/health-library').then((m) => m.HealthLibrary), { loading: PartLoading });
const WorkbookAsk = dynamic(() => import('@/components/health/workbook-advisor').then((m) => m.WorkbookAsk), { loading: PartLoading });
const WorkbookAdviceView = dynamic(() => import('@/components/health/workbook-advisor').then((m) => m.WorkbookAdviceView), { loading: PartLoading });

/**
 * The session the running plan sets for today, or null when no plan is running
 * or its week has no entry for this weekday. A plan's days are named
 * ("Monday"), so today is matched by name, in India time like the rest of the app.
 */
function todaysWorkout(plans: HealthPlanRecord[]): { plan: HealthPlanRecord; day: WorkoutDay } | null {
  const plan = plans.find((record) => !planWeek(record).done);
  if (!plan) return null;
  const weekday = new Date().toLocaleDateString('en-US', { weekday: 'long', timeZone: 'Asia/Kolkata' }).slice(0, 3).toLowerCase();
  const day = plan.plan.workout.week.find((item) => item.day.trim().toLowerCase().startsWith(weekday));
  return day ? { plan, day } : null;
}

/** "3 × 12 · 30 sec": whatever the plan gave for an exercise, on one line. */
function dose(exercise: WorkoutDay['exercises'][number]) {
  const volume = exercise.sets && exercise.reps ? `${exercise.sets} × ${exercise.reps}` : exercise.sets ?? exercise.reps;
  return [volume, exercise.duration].filter(Boolean).join(' · ');
}

// The daily step target the rings are drawn against.
const STEP_TARGET = 10_000;

type HealthView = { name: 'main' | 'ask' | 'advice' | 'docs' } | { name: 'plans'; planId: string | null };

// Main shows the first few documents; the Documents view has the rest.
const HEALTH_DOCS_ON_MAIN = 3;

export function HealthScreen({ intent = null, stepsSummary, healthLibrary, savedContextCount, hasSavedFitnessPersona, fitnessPersona, hasSavedPersonalProfile, savedWorkbookAdvice }: { intent?: HeadsupAction | null; stepsSummary: StepsSummary; healthLibrary: LibraryState; savedContextCount: number; hasSavedFitnessPersona: boolean; fitnessPersona: FitnessPersonaSummary; hasSavedPersonalProfile: boolean; savedWorkbookAdvice: SavedWorkbookAdvice | null }) {
  // A heads-up about a finished plan opens that plan; the steps one lands on main, where steps come first.
  const [view, setView] = useState<HealthView>(() => intent?.type === 'open_health_plan' ? { name: 'plans', planId: intent.planId } : { name: 'main' });
  // Advice lives here rather than in the Ask view, so a fresh answer survives
  // going back to the tab — the server copy only arrives on the next load.
  const [advice, setAdvice] = useState<ShownAdvice | null>(() => adviceFromSaved(savedWorkbookAdvice));
  const top = useScrollTop(view.name === 'plans' ? `plans-${view.planId ?? ''}` : view.name);
  const main = () => setView({ name: 'main' });
  const { documents, plans } = healthLibrary;
  const today = todaysWorkout(plans);
  // Coaching style is set once and rarely touched, so it stays one row until opened.
  const [coaching, setCoaching] = useState(false);

  if (view.name === 'ask') return (
    <div className="screen-body field">
      <span ref={top} hidden />
      <WorkbookAsk hasStepData={Boolean(stepsSummary.latest)} savedContextCount={savedContextCount} hasSavedFitnessPersona={hasSavedFitnessPersona} hasSavedPersonalProfile={hasSavedPersonalProfile} onAdvice={(next) => { setAdvice(next); setView({ name: 'advice' }); }} onBack={main} />
    </div>
  );

  if (view.name === 'advice' && advice) return (
    <div className="screen-body field">
      <span ref={top} hidden />
      <WorkbookAdviceView advice={advice} onDeleted={() => { setAdvice(null); main(); }} onPlan={() => setView({ name: 'plans', planId: null })} onBack={main} />
    </div>
  );

  if (view.name === 'plans') return (
    <div className="screen-body field">
      <span ref={top} hidden />
      <PlanBuilder plans={plans} state={healthLibrary.state} initialPlanId={view.planId} onBack={main} />
    </div>
  );

  if (view.name === 'docs') return (
    <div className="screen-body field">
      <span ref={top} hidden />
      <FieldSubHead crumb="Health · documents" title="Documents" onBack={main} backLabel="Back to Health" />
      <HealthLibrary documents={documents} state={healthLibrary.state} />
    </div>
  );

  return (
    <div className="screen-body field">
      <span ref={top} hidden />
      <FieldHead title="Health" />

      {/* Plans come first: in the gym, today's session is what the tab is opened
          for, so it is on screen without scrolling. Every plan has a finish
          line, so each row carries its bar; a row opens its own view. */}
      <section className="fd-quiet">
        <h2>{today ? 'Today’s workout' : 'Plans'}</h2>
        {today && (
          <button className="hl-today" type="button" onClick={() => setView({ name: 'plans', planId: today.plan.id })} suppressHydrationWarning>
            <span className="hl-today-head">
              <strong>{today.day.focus}</strong>
              <small>{today.day.day}{today.day.durationMinutes ? ` · ${today.day.durationMinutes} min` : ''}</small>
            </span>
            {today.day.rest || !today.day.exercises.length ? (
              <span className="hl-today-rest">{today.day.rest ? 'Rest or light movement: a walk, stretching or mobility.' : 'No exercises listed for today.'}</span>
            ) : (
              <span className="hl-today-list">
                {today.day.exercises.map((exercise, index) => (
                  <span key={`${exercise.name}-${index}`}><b>{exercise.name}</b><i>{dose(exercise)}</i></span>
                ))}
              </span>
            )}
          </button>
        )}
        {plans.map((plan) => {
          const { week, total, done } = planWeek(plan);
          return (
            <button className="hl-row" type="button" key={plan.id} onClick={() => setView({ name: 'plans', planId: plan.id })}>
              <span className="hl-row-top"><strong>{plan.title}</strong><small>{done ? `${total} weeks · done` : `week ${week} of ${total}`}</small></span>
              <span className="hl-bar" aria-hidden="true"><i style={{ width: `${done ? 100 : (week / total) * 100}%` }} /></span>
            </button>
          );
        })}
        <button className="fd-line" type="button" onClick={() => setView({ name: 'plans', planId: null })}>
          <span>{plans.length ? 'All plans, or build a new one' : 'A workout, nutrition and sleep plan'}</span>
          <b className="fd-yes">{plans.length ? 'Open' : 'Build'}</b>
        </button>
      </section>

      {/* Steps are one card: rings, chart, the 30-day comparison and the import
          row. They used to be four cards under a headline number that the
          rings repeated directly below it. */}
      <StepsCard summary={stepsSummary} stepGoal={STEP_TARGET} />

      <section className="fd-quiet">
        <h2>Documents</h2>
        <div className="hl-bento">
          {documents.slice(0, HEALTH_DOCS_ON_MAIN).map((document) => (
            <button className="hl-tile" type="button" key={document.id} onClick={() => setView({ name: 'docs' })}>
              <span className="fd-tile" aria-hidden="true">{document.kind === 'pdf' ? <FileText size={17} strokeWidth={1.8} /> : <FileSpreadsheet size={17} strokeWidth={1.8} />}</span>
              <strong>{document.fileName}</strong>
              <small>{document.kind === 'pdf' ? 'PDF' : 'Excel'} · {document.alwaysInclude ? 'read in every plan' : `added ${documentAdded(document.createdAt)}`}</small>
            </button>
          ))}
          <button className="hl-tile add" type="button" onClick={() => setView({ name: 'docs' })}>
            <span className="fd-tile" aria-hidden="true"><Plus size={17} strokeWidth={2} /></span>
            <strong>{documents.length > HEALTH_DOCS_ON_MAIN ? `All ${documents.length} documents` : documents.length ? 'Add or manage' : 'Add a file'}</strong>
            <small>Files Orbis reads when it builds a plan</small>
          </button>
        </div>
      </section>

      {advice && (
        <section className="fd-quiet">
          <h2>Advice</h2>
          <button className="fd-line" type="button" onClick={() => setView({ name: 'advice' })}>
            <span className="fd-two">{splitSummary(advice.advice.summary).headline}<small>{advice.title ?? 'Saved advice'}{advice.savedAt ? ` · saved ${savedWhen(advice.savedAt)}` : ''}</small></span>
            <b className="fd-yes">Read</b>
          </button>
        </section>
      )}

      <section className="fd-quiet">
        <h2>Coaching style</h2>
        <button className="fd-line" type="button" aria-expanded={coaching} onClick={() => setCoaching(!coaching)}>
          <span className="fd-two hl-clip">{fitnessPersona.persona ? fitnessPersona.persona.trim().split('\n')[0].replace(/^#+\s*/, '') : 'Not set'}<small>Optional: how Orbis coaches you when you ask for advice</small></span>
          <b className="fd-yes">{coaching ? 'Close' : fitnessPersona.persona ? 'Open' : 'Set'}</b>
        </button>
        {coaching && (
          <div className="hl-coach">
            <FitnessPersonaEditor key={fitnessPersona.persona ? 'persona-saved' : 'persona-empty'} state={fitnessPersona.state} persona={fitnessPersona.persona} />
          </div>
        )}
      </section>

      <div className="hl-ask">
        <span>Ask about a file. Orbis reads only what you pick, and shows it first.</span>
        <button type="button" onClick={() => setView({ name: 'ask' })}>Ask about a file</button>
      </div>
      <p className="fd-note">Suggestions are informational and aren’t a medical diagnosis.</p>
    </div>
  );
}
