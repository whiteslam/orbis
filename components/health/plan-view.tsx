'use client';

import { useState } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, Apple, BedDouble, Dumbbell, Flag, Moon, Sun, Target } from 'lucide-react';
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
    <div className="plan-sleep-clock" role="img" aria-label={`Sleep from ${bedtime} to ${wakeTime}`}>
      <div className="plan-sleep-track">
        {segments.map(([from, to]) => <i key={from} style={{ left: pct(from), width: pct(to - from) }} />)}
      </div>
      <div className="plan-sleep-scale"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div>
    </div>
  );
}

function TargetChart({ metric, unit, points }: HealthPlan['targets'][number]) {
  const first = points[0];
  const last = points[points.length - 1];
  return (
    <div className="plan-target">
      <div className="plan-target-head">
        <strong>{metric}</strong>
        <span>{first.value.toLocaleString('en-IN')} → <b>{last.value.toLocaleString('en-IN')}</b> {unit}</span>
      </div>
      <ResponsiveContainer width="100%" height={120}>
        <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="#e8edf3" />
          <XAxis dataKey="week" tickLine={false} axisLine={false} tick={{ fontSize: 9, fill: '#75808f' }} tickFormatter={(week: number) => (week === 0 ? 'Now' : `W${week}`)} />
          <YAxis tickLine={false} axisLine={false} width={40} tick={{ fontSize: 9, fill: '#75808f' }} domain={['auto', 'auto']} tickFormatter={(value: number) => value.toLocaleString('en-IN', { notation: 'compact' })} />
          <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid #e8edf3', fontSize: 11 }} labelFormatter={(week) => (Number(week) === 0 ? 'Today' : `Week ${week}`)} formatter={(value) => [`${Number(value).toLocaleString('en-IN')} ${unit}`, metric]} />
          <Line type="monotone" dataKey="value" stroke="#2a78d6" strokeWidth={2} dot={{ r: 3, fill: '#2a78d6', stroke: '#fff', strokeWidth: 2 }} activeDot={{ r: 5 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function PlanView({ plan }: { plan: HealthPlan }) {
  const firstTraining = Math.max(0, plan.workout.week.findIndex((day) => !day.rest));
  const [dayIndex, setDayIndex] = useState(firstTraining);
  const day = plan.workout.week[dayIndex];

  return (
    <article className="plan-view">
      <header className="plan-hero">
        <small>{plan.durationWeeks}-WEEK PLAN</small>
        <h3>{plan.title}</h3>
        <p>{plan.summary}</p>
      </header>

      {plan.cautions.length > 0 && (
        <div className="plan-cautions">
          <AlertTriangle size={14} aria-hidden="true" />
          <ul>{plan.cautions.map((caution) => <li key={caution}>{caution}</li>)}</ul>
        </div>
      )}

      <section className="plan-section">
        <h4><Dumbbell size={15} aria-hidden="true" /> Workout week</h4>
        {plan.workout.overview && <p className="plan-note">{plan.workout.overview}</p>}
        <div className="plan-days" role="tablist" aria-label="Days">
          {plan.workout.week.map((item, index) => (
            <button key={item.day} type="button" role="tab" aria-selected={index === dayIndex} className={`${index === dayIndex ? 'active' : ''} ${item.rest ? 'rest' : ''}`} onClick={() => setDayIndex(index)}>
              <span>{item.day.slice(0, 3)}</span><i aria-hidden="true" />
            </button>
          ))}
        </div>
        {day && (
          <div className="plan-day">
            <div className="plan-day-head"><strong>{day.focus}</strong>{day.durationMinutes ? <span>{day.durationMinutes} min</span> : null}</div>
            {day.rest || !day.exercises.length ? (
              <p className="plan-note">{day.rest ? 'Rest or light movement: a walk, stretching or mobility.' : 'No exercises listed for this day.'}</p>
            ) : (
              <ol className="plan-exercises">
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
        {plan.workout.progression && <p className="plan-note"><b>Progression:</b> {plan.workout.progression}</p>}
      </section>

      {plan.targets.length > 0 && (
        <section className="plan-section">
          <h4><Target size={15} aria-hidden="true" /> Targets</h4>
          <div className="plan-targets">{plan.targets.map((series) => <TargetChart key={series.metric} {...series} />)}</div>
        </section>
      )}

      {plan.milestones.length > 0 && (
        <section className="plan-section">
          <h4><Flag size={15} aria-hidden="true" /> Milestones</h4>
          <ol className="plan-timeline">
            {plan.milestones.map((milestone) => (
              <li key={`${milestone.week}-${milestone.title}`}>
                <span className="plan-timeline-week">W{milestone.week}</span>
                <div><strong>{milestone.title}</strong>{milestone.detail && <p>{milestone.detail}</p>}</div>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section className="plan-section">
        <h4><Apple size={15} aria-hidden="true" /> Nutrition</h4>
        {plan.nutrition.overview && <p className="plan-note">{plan.nutrition.overview}</p>}
        {plan.nutrition.dailyTargets.length > 0 && <div className="plan-chips">{plan.nutrition.dailyTargets.map((item) => <div key={item.label}><span>{item.label}</span><strong>{item.value}</strong></div>)}</div>}
        {plan.nutrition.meals.map((meal) => <div className="plan-meal" key={meal.meal}><strong>{meal.meal}</strong><p>{meal.ideas}</p></div>)}
        {plan.nutrition.tips.length > 0 && <ul className="plan-list">{plan.nutrition.tips.map((tip) => <li key={tip}>{tip}</li>)}</ul>}
      </section>

      <section className="plan-section">
        <h4><BedDouble size={15} aria-hidden="true" /> Sleep & recovery</h4>
        <div className="plan-chips">
          <div><span><Moon size={11} /> Bedtime</span><strong>{plan.sleep.bedtime || '—'}</strong></div>
          <div><span><Sun size={11} /> Wake</span><strong>{plan.sleep.wakeTime || '—'}</strong></div>
          <div><span>Target</span><strong>{plan.sleep.targetHours} h</strong></div>
        </div>
        <SleepClock bedtime={plan.sleep.bedtime} wakeTime={plan.sleep.wakeTime} />
        {plan.sleep.habits.length > 0 && <ul className="plan-list">{plan.sleep.habits.map((habit) => <li key={habit}>{habit}</li>)}</ul>}
        {plan.sleep.recovery.length > 0 && <><p className="plan-note"><b>Recovery</b></p><ul className="plan-list">{plan.sleep.recovery.map((item) => <li key={item}>{item}</li>)}</ul></>}
      </section>

      {plan.sources.length > 0 && <p className="plan-sources">Based on: {plan.sources.join(' · ')}</p>}
      <p className="health-disclaimer">This plan is general guidance, not medical advice. Check with a doctor before starting if you have a health condition.</p>
    </article>
  );
}
