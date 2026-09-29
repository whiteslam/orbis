'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { FieldHead, FieldHero, FieldSubHead, useScrollTop } from '@/components/field/field';
import { PartLoading } from '@/components/shell/loading';
import { adviceFromSaved, savedWhen, splitSummary, type ShownAdvice } from '@/lib/workbook/shown-advice';
import { documentAdded } from '@/lib/health-docs/format';
import { planWeek } from '@/lib/health/plan-week';
import type { LibraryState } from '@/lib/health-docs/repository';
import type { StepsSummary } from '@/lib/health/types';
import type { SavedWorkbookAdvice } from '@/lib/ai/saved';

const StepsCard = dynamic(() => import('@/components/health/steps-card').then((m) => m.StepsCard), { loading: PartLoading });
const PlanBuilder = dynamic(() => import('@/components/health/plan-builder').then((m) => m.PlanBuilder), { loading: PartLoading });
const HealthLibrary = dynamic(() => import('@/components/health/health-library').then((m) => m.HealthLibrary), { loading: PartLoading });
const WorkbookAsk = dynamic(() => import('@/components/health/workbook-advisor').then((m) => m.WorkbookAsk), { loading: PartLoading });
const WorkbookAdviceView = dynamic(() => import('@/components/health/workbook-advisor').then((m) => m.WorkbookAdviceView), { loading: PartLoading });

/**
 * Month-on-month change in the daily step average, or null when there is not
 * enough history to state one. Mirrors the rule in lib/focus/home.ts, so the
 * brief and the Health hero never disagree about the direction.
 */
function stepTrend(steps: StepsSummary) {
  if (steps.average30 === null || steps.previous30 === null || steps.previous30 <= 0) return null;
  return Math.round(((steps.average30 - steps.previous30) / steps.previous30) * 100);
}

// The daily step target the rings are drawn against.
const STEP_TARGET = 10_000;

type HealthView = { name: 'main' | 'ask' | 'advice' | 'docs' } | { name: 'plans'; planId: string | null };

// Main shows the first few documents; the Documents view has the rest.
const HEALTH_DOCS_ON_MAIN = 3;

export function HealthScreen({ stepsSummary, healthLibrary, savedContextCount, hasSavedFitnessPersona, hasSavedPersonalProfile, savedWorkbookAdvice }: { stepsSummary: StepsSummary; healthLibrary: LibraryState; savedContextCount: number; hasSavedFitnessPersona: boolean; hasSavedPersonalProfile: boolean; savedWorkbookAdvice: SavedWorkbookAdvice | null }) {
  const [view, setView] = useState<HealthView>({ name: 'main' });
  // Advice lives here rather than in the Ask view, so a fresh answer survives
  // going back to the tab — the server copy only arrives on the next load.
  const [advice, setAdvice] = useState<ShownAdvice | null>(() => adviceFromSaved(savedWorkbookAdvice));
  const top = useScrollTop(view.name === 'plans' ? `plans-${view.planId ?? ''}` : view.name);
  const main = () => setView({ name: 'main' });
  const trend = stepTrend(stepsSummary);
  const { documents, plans } = healthLibrary;

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
      {stepsSummary.average7 !== null && (
        <FieldHero
          value={Math.round(stepsSummary.average7).toLocaleString('en-IN')}
          label="steps a day, 7-day average"
          delta={trend === null || Math.abs(trend) < 1 ? null : { text: `${Math.abs(trend)}%`, tone: trend > 0 ? 'up' : 'down' }}
        />
      )}
      {/* Health opens on the rings themselves. The composed statement and the
          "Your numbers" rows said the same thing in words directly above the
          card that shows it, so both are gone rather than restated here. */}
      <StepsCard summary={stepsSummary} stepGoal={STEP_TARGET} />

      {/* Every plan has a finish line, so each row carries its bar;
          a row opens its own view, and the last row of each section is the way in. */}
      <section className="fd-quiet">
        <h2>Plans</h2>
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

      <section className="fd-quiet">
        <h2>Documents</h2>
        {documents.slice(0, HEALTH_DOCS_ON_MAIN).map((document) => (
          <button className="fd-line" type="button" key={document.id} onClick={() => setView({ name: 'docs' })}>
            <span className="fd-two">{document.fileName}<small>{document.kind === 'pdf' ? 'PDF' : 'Excel'} · {document.alwaysInclude ? 'read in every plan' : `added ${documentAdded(document.createdAt)}`}</small></span>
            <b className="fd-yes">Open</b>
          </button>
        ))}
        <button className="fd-line" type="button" onClick={() => setView({ name: 'docs' })}>
          <span>{documents.length > HEALTH_DOCS_ON_MAIN ? `All ${documents.length} documents` : documents.length ? 'Add or manage documents' : 'Files Orbis reads when it builds a plan'}</span>
          <b className="fd-yes">{documents.length ? 'Manage' : 'Add'}</b>
        </button>
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

      <div className="hl-ask">
        <span>Ask about a file. Orbis reads only what you pick, and shows it first.</span>
        <button type="button" onClick={() => setView({ name: 'ask' })}>Ask</button>
      </div>
      <p className="fd-note">Suggestions are informational and aren’t a medical diagnosis.</p>
    </div>
  );
}
