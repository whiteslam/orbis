'use client';

import { useState, type ReactNode } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, Apple, BedDouble, Dumbbell, Flag, Target } from 'lucide-react';
import type { HealthPlan } from '@/lib/health-docs/types';

const toMinutes = (value: string) => {
  const match = /^(\d{1,2}):(\d{2})/.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};

// 24-hour bar with the sleep window shaded (wraps past midnight).
function SleepClock({ bedtime, wakeTime }: { bedtime: string; wakeTime: string }) {
  const start = toMinutes(bedtime);
  const end = toMinutes(wakeTime);
  if (start === null || end === null) return null;
  const pct = (minutes: number) => `${(minutes / 1440) * 100}%`;
  const segments = start < end ? [[start, end]] : [[start, 1440], [0, end]];
  return (
    <div className="hl-sleep" role="img" aria-label={`Sleep from ${bedtime} to ${wakeTime}`}>
      <div className="hl-sleep-track">
        {segments.map(([from, to]) => <i key={from} style={{ left: pct(from), width: pct(to - from) }} />)}
      </div>
      <div className="hl-sleep-scale" aria-hidden="true"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div>
    </div>
  );
}

function TargetChart({ metric, unit, points }: HealthPlan['targets'][number]) {
  const first = points[0];
  const last = points[points.length - 1];
  return (
    <div className="hl-target">
      <div className="hl-target-head">
        <strong>{metric}</strong>
        <span>{first.value.toLocaleString('en-IN')} → <b>{last.value.toLocaleString('en-IN')}</b> {unit}</span>
      </div>
      <ResponsiveContainer width="100%" height={112}>
        <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke={'var(--fd-rule)'} />
          <XAxis dataKey="week" tickLine={false} axisLine={false} tick={{ fontSize: 9, fill: 'var(--fd-faint)' }} tickFormatter={(week: number) => (week === 0 ? 'Now' : `W${week}`)} />
          <YAxis tickLine={false} axisLine={false} width={34} tick={{ fontSize: 9, fill: 'var(--fd-faint)' }} domain={['auto', 'auto']} tickFormatter={(value: number) => value.toLocaleString('en-IN', { notation: 'compact', maximumFractionDigits: 1 })} />
          <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid var(--fd-rule)', background: 'var(--fd-surface)', color: 'var(--fd-ink)', fontSize: 11 }} labelFormatter={(week) => (Number(week) === 0 ? 'Today' : `Week ${week}`)} formatter={(value) => [`${Number(value).toLocaleString('en-IN')} ${unit}`, metric]} />
          <Line type="monotone" dataKey="value" stroke="var(--series-1)" strokeWidth={2} dot={{ r: 3, fill: 'var(--series-1)', stroke: 'var(--fd-surface)', strokeWidth: 2 }} activeDot={{ r: 5 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function Section({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="hl-plan-section">
      <h2 className="hl-section-label">{icon}{title}</h2>
      {children}
    </section>
  );
}

function Stats({ items }: { items: Array<{ label: string; value: string }> }) {
  return (
    <dl className="hl-stats">
      {items.map((item) => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}
    </dl>
  );
}

const ICON = { size: 13, strokeWidth: 2, 'aria-hidden': true } as const;

/** A generated plan, read top to bottom on the ground: no cards except the day picker and the figures. */
export function PlanView({ plan }: { plan: HealthPlan }) {
  const firstTraining = Math.max(0, plan.workout.week.findIndex((day) => !day.rest));
  const [dayIndex, setDayIndex] = useState(firstTraining);
  const day = plan.workout.week[dayIndex];

  return (
    <article className="hl-plan">
      <header>
        <p className="fd-kicker">{plan.durationWeeks}-week plan</p>
        <h1>{plan.title}</h1>
        <p className="hl-plan-summary">{plan.summary}</p>
      </header>

      {plan.cautions.length > 0 && (
        <div className="hl-cautions">
          <AlertTriangle size={16} strokeWidth={2} aria-hidden="true" />
          <ul>{plan.cautions.map((caution) => <li key={caution}>{caution}</li>)}</ul>
        </div>
      )}

      <Section icon={<Dumbbell {...ICON} />} title="Workout week">
        {plan.workout.overview && <p className="hl-plan-note">{plan.workout.overview}</p>}
        <div className="hl-days" role="tablist" aria-label="Days">
          {plan.workout.week.map((item, index) => (
            <button key={item.day} type="button" role="tab" aria-selected={index === dayIndex} className={item.rest ? 'rest' : ''} onClick={() => setDayIndex(index)} aria-label={`${item.day}${item.rest ? ', rest' : ''}`}>
              <span>{item.day.slice(0, 3)}</span><i aria-hidden="true" />
            </button>
          ))}
        </div>
        {day && (
          <div role="tabpanel">
            <div className="hl-day-head"><strong>{day.focus}</strong>{day.durationMinutes ? <span>{day.durationMinutes} min</span> : null}</div>
            {day.rest || !day.exercises.length ? (
              <p className="hl-plan-note">{day.rest ? 'Rest or light movement: a walk, stretching or mobility.' : 'No exercises listed for this day.'}</p>
            ) : (
              <ol className="hl-exercises">
                {day.exercises.map((exercise) => (
                  <li key={exercise.name}>
                    <strong>{exercise.name}</strong>
                    <span>{[exercise.sets && `${exercise.sets} sets`, exercise.reps && `${exercise.reps} reps`, exercise.duration].filter(Boolean).join(' · ')}</span>
                    {exercise.notes && <small>{exercise.notes}</small>}
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
        {plan.workout.progression && <p className="hl-plan-note"><b>Progression:</b> {plan.workout.progression}</p>}
      </Section>

      {plan.targets.length > 0 && (
        <Section icon={<Target {...ICON} />} title="Targets">
          {plan.targets.map((series) => <TargetChart key={series.metric} {...series} />)}
        </Section>
      )}

      {plan.milestones.length > 0 && (
        <Section icon={<Flag {...ICON} />} title="Milestones">
          <ol className="hl-milestones">
            {plan.milestones.map((milestone) => (
              <li key={`${milestone.week}-${milestone.title}`}>
                <span>W{milestone.week}</span>
                <div><strong>{milestone.title}</strong>{milestone.detail && <p>{milestone.detail}</p>}</div>
              </li>
            ))}
          </ol>
        </Section>
      )}

      <Section icon={<Apple {...ICON} />} title="Nutrition">
        {plan.nutrition.overview && <p className="hl-plan-note">{plan.nutrition.overview}</p>}
        {plan.nutrition.dailyTargets.length > 0 && <Stats items={plan.nutrition.dailyTargets} />}
        {plan.nutrition.meals.map((meal) => <div className="hl-meal" key={meal.meal}><strong>{meal.meal}</strong><p>{meal.ideas}</p></div>)}
        {plan.nutrition.tips.length > 0 && <ul className="hl-bullets">{plan.nutrition.tips.map((tip) => <li key={tip}>{tip}</li>)}</ul>}
      </Section>

      <Section icon={<BedDouble {...ICON} />} title="Sleep & recovery">
        <Stats items={[
          { label: 'Bedtime', value: plan.sleep.bedtime || '—' },
          { label: 'Wake', value: plan.sleep.wakeTime || '—' },
          { label: 'Target', value: `${plan.sleep.targetHours} h` },
        ]} />
        <SleepClock bedtime={plan.sleep.bedtime} wakeTime={plan.sleep.wakeTime} />
        {plan.sleep.habits.length > 0 && <ul className="hl-bullets">{plan.sleep.habits.map((habit) => <li key={habit}>{habit}</li>)}</ul>}
        {plan.sleep.recovery.length > 0 && <><p className="hl-plan-note"><b>Recovery</b></p><ul className="hl-bullets tight">{plan.sleep.recovery.map((item) => <li key={item}>{item}</li>)}</ul></>}
      </Section>

      {plan.sources.length > 0 && <p className="fd-note">Based on: {plan.sources.join(' · ')}</p>}
      <p className="fd-note tight">This plan is general guidance, not medical advice. Check with a doctor before starting if you have a health condition.</p>
    </article>
  );
}
