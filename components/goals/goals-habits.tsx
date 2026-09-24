'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Plus, Target } from 'lucide-react';
import { checkInHabitAction, createGoalAction, createHabitAction, updateGoalProgressAction } from '@/app/goals/actions';
import type { GoalsSummary } from '@/lib/goals/types';

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

  if (!data.databaseReady) return <div className="empty-state"><Target size={22} /><strong>Goals and habits are not set up</strong><p>Apply the Goals and Habits migration in Supabase, then refresh.</p></div>;

  return (
    <>
      <Notice value={notice} />
      {kind === 'goals' ? (
        <>
          <form className="personal-form stack-card" onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const fields = new FormData(form);
            run(() => createGoalAction({ title: String(fields.get('title') ?? ''), target: String(fields.get('target') ?? ''), current: String(fields.get('current') ?? '0'), unit: String(fields.get('unit') ?? ''), dueDate: String(fields.get('dueDate') ?? '') }));
            form.reset();
          }}>
            <strong><Plus size={15} /> Add a goal</strong>
            <label>What do you want to achieve?<input name="title" maxLength={100} required placeholder="Lose 5 kg, run a 10K…" /></label>
            <div className="form-row"><label>Target<input name="target" type="number" min="0.01" step="0.01" required placeholder="100000" /></label><label>Current progress<input name="current" type="number" min="0" step="0.01" defaultValue="0" /></label></div>
            <div className="form-row"><label>Unit<input name="unit" maxLength={24} placeholder="kg, km, workouts…" /></label><label>Target date<input name="dueDate" type="date" /></label></div>
            <button className="finance-button primary" type="submit" disabled={isPending}>{isPending ? 'Saving…' : 'Save goal'}</button>
          </form>
          {data.goals.length ? <div className="stack-card personal-list">{data.goals.map((goal) => {
            const progress = Math.min(100, Math.round((goal.current / goal.target) * 100));
            return <article className="goal-item" key={goal.id}>
              <div className="goal-item-head"><strong>{goal.title}</strong><span>{progress}%</span></div>
              <small>{goal.current.toLocaleString()} / {goal.target.toLocaleString()}{goal.unit ? ` ${goal.unit}` : ''}{goal.dueDate ? ` · by ${goal.dueDate}` : ''}</small>
              <div className="progress"><i style={{ width: `${progress}%` }} /></div>
              <form className="progress-form" onSubmit={(event) => { event.preventDefault(); const value = new FormData(event.currentTarget).get('current'); run(() => updateGoalProgressAction(goal.id, String(value ?? ''))); }}>
                <label>Update progress<input name="current" type="number" min="0" max={goal.target} step="0.01" defaultValue={goal.current} /></label>
                <button className="finance-button secondary" type="submit" disabled={isPending}>Update</button>
              </form>
            </article>;
          })}</div> : <div className="empty-state"><Target size={22} /><strong>No goals yet</strong><p>Add a goal above to keep your progress in one place.</p></div>}
        </>
      ) : (
        <>
          <form className="personal-form stack-card habit-add" onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const title = new FormData(form).get('title');
            run(() => createHabitAction(String(title ?? '')));
            form.reset();
          }}>
            <strong><Plus size={15} /> Add a habit</strong>
            <label>Daily routine<input name="title" maxLength={100} required placeholder="Take a 20 minute walk" /></label>
            <button className="finance-button primary" type="submit" disabled={isPending}>{isPending ? 'Saving…' : 'Save habit'}</button>
          </form>
          {data.habits.length ? <div className="stack-card habit-list">{data.habits.map((habit) => <article className="habit" key={habit.id}>
            <button type="button" className={habit.checkedToday ? 'done' : ''} aria-label={habit.checkedToday ? `${habit.title} completed today` : `Check in: ${habit.title}`} disabled={isPending || habit.checkedToday} onClick={() => run(() => checkInHabitAction(habit.id, todayInAppTimezone()))}>{habit.checkedToday ? <Check size={14} /> : ''}</button>
            <div><strong>{habit.title}</strong><p>{habit.checkedToday ? 'Done today' : 'Not checked in today'} · {habit.streak} day streak</p></div>
          </article>)}</div> : <div className="empty-state"><Target size={22} /><strong>No habits yet</strong><p>Add a small routine above and check in when you complete it.</p></div>}
        </>
      )}
    </>
  );
}
