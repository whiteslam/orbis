'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Plus, Target } from 'lucide-react';
import { checkInHabitAction, createGoalAction, createHabitAction, updateGoalProgressAction } from '@/app/goals/actions';
import type { GoalSummary, GoalsSummary } from '@/lib/goals/types';
import { FieldLabel } from '@/components/field/field';
import { safeAction } from '@/lib/client/safe-action';

function todayInAppTimezone() {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function Notice({ value }: { value: { text: string; success: boolean } | null }) {
  if (!value) return null;
  return <p className={`finance-notice ${value.success ? 'success' : 'error'}`} role="status">{value.text}</p>;
}

export function GoalsHabits({ kind, data }: { kind: 'goals' | 'habits'; data: GoalsSummary }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [notice, setNotice] = useState<{ text: string; success: boolean } | null>(null);

  function run(action: () => Promise<{ success: boolean; message: string }>) {
    setNotice(null);
    startTransition(async () => {
      const result = await action();
      setNotice({ text: result.message, success: result.success });
      if (result.success) router.refresh();
    });
  }

  if (!data.databaseReady && kind === 'goals') return <p className="fd-msg bad">Goals are not set up. Apply the Goals and Habits migration in Supabase, then refresh.</p>;
  if (!data.databaseReady) return <div className="empty-state"><Target size={22} /><strong>Goals and habits are not set up</strong><p>Apply the Goals and Habits migration in Supabase, then refresh.</p></div>;

  return (
    <>
      {kind === 'habits' && <Notice value={notice} />}
      {kind === 'goals' ? (
        <GoalsBody data={data} isPending={isPending} run={run} notice={notice} />
      ) : (
        <>
          <form className="personal-form stack-card habit-add" onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const title = new FormData(form).get('title');
            run(() => safeAction(createHabitAction)(String(title ?? '')));
            form.reset();
          }}>
            <strong><Plus size={15} /> Add a habit</strong>
            <label>Daily routine<input name="title" maxLength={100} required placeholder="Take a 20 minute walk" /></label>
            <button className="finance-button primary" type="submit" disabled={isPending}>{isPending ? 'Saving…' : 'Save habit'}</button>
          </form>
          {data.habits.length ? <div className="stack-card habit-list">{data.habits.map((habit) => <article className="habit" key={habit.id}>
            <button type="button" className={habit.checkedToday ? 'done' : ''} aria-label={habit.checkedToday ? `${habit.title} completed today` : `Check in: ${habit.title}`} disabled={isPending || habit.checkedToday} onClick={() => run(() => safeAction(checkInHabitAction)(habit.id, todayInAppTimezone()))}>{habit.checkedToday ? <Check size={14} /> : ''}</button>
            <div><strong>{habit.title}</strong><p>{habit.checkedToday ? 'Done today' : 'Not checked in today'} · {habit.streak} day streak</p></div>
          </article>)}</div> : <div className="empty-state"><Target size={22} /><strong>No habits yet</strong><p>Add a small routine above and check in when you complete it.</p></div>}
        </>
      )}
    </>
  );
}

type Run = (action: () => Promise<{ success: boolean; message: string }>) => void;

function dueLabel(date: string) {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

const amount = (value: number) => value.toLocaleString('en-IN', { maximumFractionDigits: 2 });

/** Goals in the Atlas layout: each active goal with its bar and update field, then the form to add one. */
function GoalsBody({ data, isPending, run, notice }: { data: GoalsSummary; isPending: boolean; run: Run; notice: { text: string; success: boolean } | null }) {
  return (
    <>
      <FieldLabel>Active</FieldLabel>
      {data.goals.length ? data.goals.map((goal) => <GoalRow key={goal.id} goal={goal} isPending={isPending} run={run} />) : <p className="fd-empty">No goals yet. Add one below to keep your progress in one place.</p>}

      <form className="fd-form hl-goal-add" onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const fields = new FormData(form);
        run(() => safeAction(createGoalAction)({ title: String(fields.get('title') ?? ''), target: String(fields.get('target') ?? ''), current: String(fields.get('current') ?? '0'), unit: String(fields.get('unit') ?? ''), dueDate: String(fields.get('dueDate') ?? '') }));
        form.reset();
      }}>
        <FieldLabel>Add a goal</FieldLabel>
        <label className="fd-field wide">What do you want to achieve?<input name="title" maxLength={100} required placeholder="Lose 5 kg, run a 10K…" /></label>
        <div className="fd-grid">
          <label className="fd-field">Target<input name="target" type="number" min="0.01" step="0.01" required placeholder="100" /></label>
          <label className="fd-field">Current progress<input name="current" type="number" min="0" step="0.01" defaultValue="0" /></label>
          <label className="fd-field">Unit<input name="unit" maxLength={24} placeholder="kg, km, workouts…" /></label>
          <label className="fd-field">Target date<input name="dueDate" type="date" /></label>
        </div>
        <div className="fd-act"><button type="submit" disabled={isPending}>{isPending ? 'Saving…' : 'Save goal'}</button></div>
      </form>
      {notice && <p className={`fd-msg ${notice.success ? 'ok' : 'bad'}`} role="status">{notice.text}</p>}
    </>
  );
}

function GoalRow({ goal, isPending, run }: { goal: GoalSummary; isPending: boolean; run: Run }) {
  const progress = Math.min(100, Math.round((goal.current / goal.target) * 100));
  const inputId = `goal-${goal.id}`;
  return (
    <article className="hl-goal">
      <div className="hl-goal-head"><strong>{goal.title}</strong><b>{progress}%</b></div>
      <small>{amount(goal.current)} of {amount(goal.target)}{goal.unit ? ` ${goal.unit}` : ''} · {goal.dueDate ? `by ${dueLabel(goal.dueDate)}` : 'no date set'}</small>
      <span className="hl-bar big" aria-hidden="true"><i style={{ width: `${progress}%` }} /></span>
      <form className="hl-goal-update" onSubmit={(event) => { event.preventDefault(); const value = new FormData(event.currentTarget).get('current'); run(() => safeAction(updateGoalProgressAction)(goal.id, String(value ?? ''))); }}>
        <label className="fd-field" htmlFor={inputId}>Update progress</label>
        <div>
          <input id={inputId} name="current" type="number" min="0" max={goal.target} step="0.01" defaultValue={goal.current} />
          <div className="fd-act"><button className="ghost" type="submit" disabled={isPending}>Update</button></div>
        </div>
      </form>
    </article>
  );
}
