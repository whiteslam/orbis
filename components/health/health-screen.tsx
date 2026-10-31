'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { ChevronRight, FileSpreadsheet, FileText, Plus } from 'lucide-react';
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

type TodaysWorkout = NonNullable<ReturnType<typeof todaysWorkout>>;

/** Today's session from the running plan; tapping it opens that plan. */
function TodayWorkout({ today, onOpen }: Readonly<{ today: TodaysWorkout; onOpen: () => void }>) {
  return (
    <button className="hl-today" type="button" onClick={onOpen} suppressHydrationWarning>
      <span className="hl-today-head">
        <small>{today.day.day}{today.day.durationMinutes ? ` · ${today.day.durationMinutes} min` : ''} · {today.plan.title}</small>
        <strong>{today.day.focus}</strong>
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
      <span className="hl-today-open">Open the plan <ChevronRight size={14} strokeWidth={2.2} aria-hidden="true" /></span>
    </button>
  );
}

/** What the last Documents tile says: see them all, manage the few, or add the first. */
function documentsTileLabel(count: number) {
  if (count > HEALTH_DOCS_ON_MAIN) return `All ${count} documents`;
  return count ? 'Add or manage' : 'Add a file';
}

/** The first few documents as rows, then a row into the Documents view. */
function DocumentTiles({ documents, onOpen }: Readonly<{ documents: LibraryState['documents']; onOpen: () => void }>) {
  return (
    <section className="hl-sec">
      <h2 className="hl-h">Documents</h2>
      <div className="hl-docrows hl-cell">
        {documents.slice(0, HEALTH_DOCS_ON_MAIN).map((document) => (
          <button className="hl-docrow" type="button" key={document.id} onClick={onOpen}>
            <span className={`hl-doc-tile ${document.kind}`} aria-hidden="true">{document.kind === 'pdf' ? <FileText size={16} strokeWidth={1.8} /> : <FileSpreadsheet size={16} strokeWidth={1.8} />}</span>
            <span className="hl-docrow-text">
              <strong>{document.fileName}</strong>
              <small>{document.kind === 'pdf' ? 'PDF' : 'Excel'} · {document.alwaysInclude ? 'read in every plan' : `added ${documentAdded(document.createdAt)}`}</small>
            </span>
          </button>
        ))}
        <button className="hl-docrow add" type="button" onClick={onOpen}>
          <span className="hl-doc-tile add" aria-hidden="true"><Plus size={16} strokeWidth={2} /></span>
          <span className="hl-docrow-text">
            <strong>{documentsTileLabel(documents.length)}</strong>
            <small>Files Orbis reads when it builds a plan</small>
          </span>
        </button>
      </div>
    </section>
  );
}

/** The coaching row's action word: close it when open, else open or set it. */
function coachingAction(coaching: boolean, persona: string | null) {
  if (coaching) return 'Close';
  return persona ? 'Open' : 'Set';
}

/** Coaching style is set once and rarely touched, so it stays one row until opened. */
function CoachingSection({ fitnessPersona, coaching, onToggle }: Readonly<{ fitnessPersona: FitnessPersonaSummary; coaching: boolean; onToggle: () => void }>) {
  return (
    <section className="hl-sec">
      <h2 className="hl-h">Coaching style</h2>
      <div className="hl-cell">
        <button className="fd-line" type="button" aria-expanded={coaching} onClick={onToggle}>
          <span className="fd-two hl-clip">{fitnessPersona.persona ? fitnessPersona.persona.trim().split('\n')[0].replace(/^#+\s*/, '') : 'Not set'}<small>Optional: how Orbis coaches you when you ask for advice</small></span>
          <b className="fd-yes">{coachingAction(coaching, fitnessPersona.persona)}</b>
        </button>
        {coaching && (
          <div className="hl-coach">
            <FitnessPersonaEditor key={fitnessPersona.persona ? 'persona-saved' : 'persona-empty'} state={fitnessPersona.state} persona={fitnessPersona.persona} />
          </div>
        )}
      </div>
    </section>
  );
}

export function HealthScreen({ intent = null, stepsSummary, healthLibrary, savedContextCount, hasSavedFitnessPersona, fitnessPersona, hasSavedPersonalProfile, savedWorkbookAdvice }: Readonly<{ intent?: HeadsupAction | null; stepsSummary: StepsSummary; healthLibrary: LibraryState; savedContextCount: number; hasSavedFitnessPersona: boolean; fitnessPersona: FitnessPersonaSummary; hasSavedPersonalProfile: boolean; savedWorkbookAdvice: SavedWorkbookAdvice | null }>) {
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
    <div className="screen-body field hl-screen hl-v-ask">
      <span ref={top} hidden />
      <WorkbookAsk hasStepData={Boolean(stepsSummary.latest)} savedContextCount={savedContextCount} hasSavedFitnessPersona={hasSavedFitnessPersona} hasSavedPersonalProfile={hasSavedPersonalProfile} onAdvice={(next) => { setAdvice(next); setView({ name: 'advice' }); }} onBack={main} />
    </div>
  );

  if (view.name === 'advice' && advice) return (
    <div className="screen-body field hl-screen hl-v-advice">
      <span ref={top} hidden />
      <WorkbookAdviceView advice={advice} onDeleted={() => { setAdvice(null); main(); }} onPlan={() => setView({ name: 'plans', planId: null })} onBack={main} />
    </div>
  );

  if (view.name === 'plans') return (
    <div className="screen-body field hl-screen hl-v-plans">
      <span ref={top} hidden />
      <PlanBuilder plans={plans} state={healthLibrary.state} initialPlanId={view.planId} onBack={main} />
    </div>
  );

  if (view.name === 'docs') return (
    <div className="screen-body field hl-screen hl-v-docs">
      <span ref={top} hidden />
      <FieldSubHead crumb="Health · documents" title="Documents" onBack={main} backLabel="Back to Health" />
      <HealthLibrary documents={documents} state={healthLibrary.state} />
    </div>
  );

  return (
    <div className="screen-body field hl-screen hl-v-main">
      <span ref={top} hidden />
      <FieldHead title="Health" />

      {/* The body's dashboard leads: the latest day's steps, the rings and the
          week, with the import beside them. Today's session follows straight
          after, so in the gym it is still on screen with one short scroll; the
          longer trend closes the page. On desktop the dashboard and trend sit
          on the left and the plans, files and advice run down the right. */}
      <div className="hl-main">
        <StepsCard summary={stepsSummary} stepGoal={STEP_TARGET}>
          <div className="hl-side">
            <section className="hl-sec hl-plans">
              <h2 className="hl-h">{today ? 'Today’s workout' : 'Plans'}</h2>
              {/* Inset grouped: each group of rows sits in one cell under its heading. */}
              {today && <div className="hl-cell"><TodayWorkout today={today} onOpen={() => setView({ name: 'plans', planId: today.plan.id })} /></div>}
              {today && plans.length > 0 && <h3 className="hl-group">Your plans</h3>}
              <div className="hl-cell">
                {plans.map((plan) => {
                  const { week, total, done } = planWeek(plan);
                  return (
                    <button className="hl-row" type="button" key={plan.id} onClick={() => setView({ name: 'plans', planId: plan.id })}>
                      <span className="hl-row-top"><strong>{plan.title}</strong><small>{done ? `${total} weeks · done` : `week ${week} of ${total}`}</small></span>
                      <span className="hl-bar" aria-hidden="true"><i style={{ '--fill': done ? 1 : week / total } as React.CSSProperties} /></span>
                    </button>
                  );
                })}
                <button className={`fd-line hl-next${plans.length ? '' : ' first'}`} type="button" onClick={() => setView({ name: 'plans', planId: null })}>
                  <span>{plans.length ? 'All plans, or build a new one' : 'A workout, nutrition and sleep plan'}</span>
                  <b className="fd-yes">{plans.length ? 'Open' : 'Build'}</b>
                </button>
              </div>
            </section>

            {advice && (
              <section className="hl-sec">
                <h2 className="hl-h">Advice</h2>
                <div className="hl-cell">
                  <button className="fd-line" type="button" onClick={() => setView({ name: 'advice' })}>
                    <span className="fd-two">{splitSummary(advice.advice.summary).headline}<small>{advice.title ?? 'Saved advice'}{advice.savedAt ? ` · saved ${savedWhen(advice.savedAt)}` : ''}</small></span>
                    <b className="fd-yes">Read</b>
                  </button>
                </div>
              </section>
            )}

            <DocumentTiles documents={documents} onOpen={() => setView({ name: 'docs' })} />

            <div className="hl-ask">
              <span>Ask about a file. Orbis reads only what you pick, and shows it first.</span>
              <button type="button" onClick={() => setView({ name: 'ask' })}>Ask about a file</button>
            </div>

            <CoachingSection fitnessPersona={fitnessPersona} coaching={coaching} onToggle={() => setCoaching(!coaching)} />
          </div>
        </StepsCard>
      </div>
      <p className="fd-note hl-foot">Suggestions are informational and aren’t a medical diagnosis.</p>
    </div>
  );
}
