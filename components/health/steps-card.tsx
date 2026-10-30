'use client';

import { useRef, useState, useTransition, type ReactNode } from 'react';
import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Flame, LoaderCircle, Trash2, Upload } from 'lucide-react';
import { deleteHealthStepsAction, importAppleHealthStepsAction } from '@/app/health/steps-actions';
import { ActivityRings } from '@/components/health/activity-rings';
import type { StepsSummary } from '@/lib/health/types';
import type { WorkerMessage } from '@/components/health/apple-health.worker';
import { safeAction } from '@/lib/client/safe-action';

const number = (value: number) => Math.round(value).toLocaleString('en-IN');
const dayLabel = (date: string, options: Intl.DateTimeFormatOptions) => new Date(`${date}T00:00:00Z`).toLocaleDateString('en-IN', { ...options, timeZone: 'UTC' });
// "Friday 30 October", built in two parts: Node and the browser punctuate the combined format differently.
const longDay = (date: string) => `${dayLabel(date, { weekday: 'long' })} ${dayLabel(date, { day: 'numeric', month: 'long' })}`;
const shiftDate = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

// Health used to carry Apple's Activity palette — pink, green, cyan, orange —
// which is a fourth colour system on top of the app's own. These read from the
// theme instead: the three rings use the validated categorical series the
// spending donut already uses, and the step bars use the Field accent, so
// every screen draws from one palette and both themes are covered.
const COLORS = { steps: 'var(--series-3)', average: 'var(--series-1)', streak: 'var(--series-4)', activity: 'var(--fd-accent)' };
const TRACK = 'var(--fd-ring-track)';
const AXIS = { line: 'var(--fd-rule)', text: 'var(--fd-faint)' };
const RANGES = [['W', 7], ['M', 30], ['3M', 90]] as const;

type Progress = { stage: string; fraction: number };

function readExport(file: File, onProgress: (progress: Progress) => void) {
  return new Promise<Extract<WorkerMessage, { type: 'done' }>['result']>((resolve, reject) => {
    const worker = new Worker(new URL('./apple-health.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const message = event.data;
      if (message.type === 'progress') return onProgress(message);
      worker.terminate();
      if (message.type === 'done') resolve(message.result);
      else reject(new Error(message.message));
    };
    worker.onerror = () => {
      worker.terminate();
      reject(new Error('This file could not be read as an Apple Health export.'));
    };
    worker.postMessage(file);
  });
}

// Calendar days ending at the latest imported day, with missing days shown as zero.
function series(summary: StepsSummary, span: number) {
  if (!summary.latest) return [];
  const byDate = new Map(summary.days.map((day) => [day.date, day.steps]));
  return Array.from({ length: span }, (_, index) => {
    const date = shiftDate(summary.latest!.date, index - span + 1);
    return { date, steps: byDate.get(date) ?? 0, recorded: byDate.has(date) };
  });
}

type Latest = NonNullable<StepsSummary['latest']>;
type LastImport = NonNullable<StepsSummary['lastImport']>;

/** "Imported 3 Oct, data up to 1 Oct": when the last export arrived and how far it reached. */
function importedLine(lastImport: LastImport) {
  const importedOn = new Date(lastImport.importedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  const reach = lastImport.lastDate ? `, data up to ${dayLabel(lastImport.lastDate, { day: 'numeric', month: 'short' })}` : '';
  return `Imported ${importedOn}${reach}`;
}

/** A tick every day over a week, every week over a month, every month over three. */
function tickInterval(span: number) {
  if (span === 7) return 0;
  return span === 30 ? 6 : 29;
}

/** The latest day against the goal, in words: how far to go, or that it is reached. */
function goalLine(steps: number, stepGoal: number) {
  if (steps >= stepGoal) return `Your ${number(stepGoal)} step goal is reached`;
  return `${number(stepGoal - steps)} to go for your ${number(stepGoal)} goal`;
}

/** The figure, the rings beside it, and what each ring means. */
function StepRings({ summary, latest, stepGoal }: Readonly<{ summary: StepsSummary; latest: Latest; stepGoal: number }>) {
  const goalDays = series(summary, 7).filter((day) => day.steps >= stepGoal).length;
  return (
    <>
      <div className="hl-rings">
        <div className="hl-figure">
          <p className="hl-figure-num"><b>{number(latest.steps)}</b> steps</p>
          <p className="hl-figure-sub">{goalLine(latest.steps, stepGoal)}</p>
        </div>
        <ActivityRings size={124} rings={[
          { label: 'Steps', value: latest.steps / stepGoal, color: COLORS.steps, track: TRACK },
          { label: '7-day average', value: (summary.average7 ?? 0) / stepGoal, color: COLORS.average, track: TRACK },
          { label: 'Goal days', value: goalDays / 7, color: COLORS.streak, track: TRACK },
        ]} />
      </div>
      {/* The ring's colour is a swatch, not the label's text colour: an amber
          or cyan word is unreadable at this size against the card. */}
      <dl className="rings-legend hl-legend">
        <div><dt><i style={{ background: COLORS.steps }} aria-hidden="true" />Steps</dt><dd><b>{number(latest.steps)}</b>/{number(stepGoal)}</dd></div>
        <div><dt><i style={{ background: COLORS.average }} aria-hidden="true" />7-day average</dt><dd><b>{number(summary.average7 ?? 0)}</b>/{number(stepGoal)}</dd></div>
        <div><dt><i style={{ background: COLORS.streak }} aria-hidden="true" />Goal days</dt><dd><b>{goalDays}</b>/7</dd></div>
      </dl>
    </>
  );
}

/** The last seven days as seven bars against the goal line: the week at a glance. */
function StepWeek({ summary, latest, stepGoal }: Readonly<{ summary: StepsSummary; latest: Latest; stepGoal: number }>) {
  const week = series(summary, 7);
  const goalDays = week.filter((day) => day.steps >= stepGoal).length;
  const scale = Math.max(stepGoal * 1.15, ...week.map((day) => day.steps));
  return (
    <div className="hl-week">
      <p className="hl-week-head"><span>Last 7 days</span><span><b>{goalDays} of 7</b> on goal</span></p>
      <ol className="hl-week-days" style={{ '--goal': stepGoal / scale } as React.CSSProperties}>
        {week.map((day) => (
          <li key={day.date} data-goal={day.steps >= stepGoal || undefined} data-latest={day.date === latest.date || undefined}>
            <small aria-hidden="true">{day.recorded ? `${(day.steps / 1000).toFixed(1)}k` : ''}</small>
            <span className="hl-week-bar" aria-hidden="true"><i style={{ '--fill': Math.min(day.steps / scale, 1) } as React.CSSProperties} /></span>
            <span aria-hidden="true">{dayLabel(day.date, { weekday: 'short' })}</span>
            <span className="sr-only">{longDay(day.date)}: {day.recorded ? `${number(day.steps)} steps` : 'no data'}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function StepsChart({ summary, latest, span, onSpan }: Readonly<{ summary: StepsSummary; latest: Latest; span: number; onSpan: (span: number) => void }>) {
  const chart = series(summary, span);
  const recorded = chart.filter((day) => day.recorded);
  const rangeAverage = recorded.length ? recorded.reduce((sum, day) => sum + day.steps, 0) / recorded.length : 0;
  return (
    <div className="hl-part hl-chart">
      <div className="hl-trend-head">
        <h2 className="hl-h" id="trend-title">Trend</h2>
        <fieldset className="apple-segmented" aria-label="Chart range">
          {RANGES.map(([label, days]) => <button key={label} type="button" aria-pressed={span === days} onClick={() => onSpan(days)}>{label}</button>)}
        </fieldset>
      </div>
      {/* One line, not a second headline: over a week this is the ring's own number. */}
      <p className="apple-metric-range hl-range">Daily average <b>{number(rangeAverage)}</b> · {dayLabel(chart[0].date, { day: 'numeric', month: 'short' })} to {dayLabel(latest.date, { day: 'numeric', month: 'short', year: 'numeric' })}</p>
      <ResponsiveContainer width="100%" height={170}>
        <BarChart data={chart} margin={{ top: 8, right: 0, bottom: 0, left: 0 }} barCategoryGap={span > 30 ? 1 : '22%'}>
          <CartesianGrid vertical={false} stroke={AXIS.line} strokeDasharray="2 3" />
          <XAxis dataKey="date" tickLine={false} axisLine={{ stroke: AXIS.line }} tick={{ fontSize: 10, fill: AXIS.text }} interval={tickInterval(span)} tickFormatter={(date: string) => dayLabel(date, span === 7 ? { weekday: 'narrow' } : { day: 'numeric', month: span > 30 ? 'short' : undefined })} />
          <YAxis orientation="right" tickLine={false} axisLine={false} width={36} tick={{ fontSize: 10, fill: AXIS.text }} tickFormatter={(value: number) => (value >= 1000 ? `${Math.round(value / 1000)}k` : String(value))} />
          <Tooltip cursor={{ fill: 'var(--fd-wash)' }} formatter={(value) => [`${number(Number(value))} steps`, '']} separator="" labelFormatter={(date) => dayLabel(String(date), { weekday: 'short', day: 'numeric', month: 'short' })} />
          <ReferenceLine y={rangeAverage} stroke={COLORS.activity} strokeDasharray="3 3" strokeOpacity={0.7} />
          <Bar dataKey="steps" fill={COLORS.activity} radius={[3, 3, 0, 0]} maxBarSize={28} animationBegin={200} animationDuration={800} animationEasing="ease-out" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function TrendBars({ average30, previous30 }: Readonly<{ average30: number; previous30: number }>) {
  const trendUp = average30 >= previous30;
  const trendMax = Math.max(average30, previous30, 1);
  const trendPercent = previous30 > 0 ? Math.round(((average30 - previous30) / previous30) * 100) : null;
  return (
    <div className="hl-part">
      <p className="apple-metric-label hl-part-label">
        Last 30 days against the 30 before
        {trendPercent !== null && Math.abs(trendPercent) >= 1 && <b className={trendUp ? 'up' : 'down'}>{trendUp ? 'up' : 'down'} {Math.abs(trendPercent)}%</b>}
      </p>
      <div className="highlight-bars">
        <div>
          <p><b>{number(average30)}</b> steps/day</p>
          <i style={{ '--fill': average30 / trendMax, background: COLORS.activity } as React.CSSProperties} />
          <small>Last 30 days</small>
        </div>
        <div>
          <p><b>{number(previous30)}</b> steps/day</p>
          <i style={{ '--fill': previous30 / trendMax, background: 'var(--fd-faint)' } as React.CSSProperties} />
          <small>Previous 30 days</small>
        </div>
      </div>
    </div>
  );
}

/** The dashboard's body: why there is nothing to show, or the figure, rings and the week. */
function StepsBody({ summary, stepGoal }: Readonly<{ summary: StepsSummary; stepGoal: number }>) {
  if (!summary.databaseReady) {
    return <p className="apple-card-empty">Apply the Health steps migration (202609240012_health_steps.sql) in Supabase to import step data.</p>;
  }
  if (summary.loadError) {
    return <p className="apple-card-empty">Step data could not be loaded. Refresh the app and try again.</p>;
  }
  const latest = summary.latest;
  if (!latest) {
    return (
      <p className="apple-card-empty">
        Browsers can’t read Apple Health directly. On your iPhone, open <b>Health</b>, tap your profile picture, choose <b>Export All Health Data</b>, and upload the export.zip here. The file is read on this device, and only daily step totals are saved.
      </p>
    );
  }
  return (
    <>
      <StepRings summary={summary} latest={latest} stepGoal={stepGoal} />
      <StepWeek summary={summary} latest={latest} stepGoal={stepGoal} />
    </>
  );
}

/** How far an import has got: the worker's stage and bar, then the save. */
function ImportProgress({ progress, isSaving }: Readonly<{ progress: Progress | null; isSaving: boolean }>) {
  if (progress) {
    return (
      <div className="steps-progress">
        <output>{progress.stage}</output>
        <div><i style={{ '--fill': Math.round(progress.fraction * 100) / 100 } as React.CSSProperties} /></div>
      </div>
    );
  }
  // The <p> keeps the .apple-row p styling it has always had; <output> carries the status role.
  return isSaving ? <p className="steps-progress"><output>Saving daily totals…</output></p> : null;
}

/**
 * Steps as the tab's dashboard: the latest day's figure and rings, the week as
 * bars, and the import row, on one surface. `children` sits between that and
 * the longer trend, so the plans come before the chart on the phone.
 */
export function StepsCard({ summary, stepGoal, children }: Readonly<{ summary: StepsSummary; stepGoal: number; children?: ReactNode }>) {
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  // The week already shows as bars in the dashboard, so the chart opens on the month.
  const [span, setSpan] = useState<number>(30);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isSaving, startSaving] = useTransition();
  const busy = Boolean(progress) || isSaving;

  async function importFile(file: File) {
    setMessage(null);
    setConfirmDelete(false);
    setProgress({ stage: 'Reading Health data…', fraction: 0 });
    try {
      const result = await readExport(file, setProgress);
      setProgress(null);
      if (!result.days.length) return setMessage({ tone: 'error', text: 'No step records were found in this export.' });
      startSaving(async () => {
        const saved = await safeAction(importAppleHealthStepsAction)({ fileName: file.name, recordCount: result.recordCount, days: result.days });
        setMessage(saved.success
          ? { tone: 'success', text: `Imported ${number(result.days.length)} days, ${dayLabel(result.firstDate!, { day: 'numeric', month: 'short', year: 'numeric' })} to ${dayLabel(result.lastDate!, { day: 'numeric', month: 'short', year: 'numeric' })}.` }
          : { tone: 'error', text: saved.message });
      });
    } catch (error) {
      setProgress(null);
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'This file could not be read as an Apple Health export.' });
    }
  }

  function deleteSteps() {
    startSaving(async () => {
      const result = await safeAction(deleteHealthStepsAction)();
      setConfirmDelete(false);
      setMessage({ tone: result.success ? 'success' : 'error', text: result.message });
    });
  }

  const ready = summary.databaseReady && !summary.loadError;
  const latest = summary.latest;

  return (
    <>
      <section className="hl-dash steps-card" aria-labelledby="steps-title">
        <h2 className="hl-dash-kicker" id="steps-title">
          <Flame size={14} fill="currentColor" aria-hidden="true" />
          <span>Steps{latest ? ` · ${longDay(latest.date)}` : ''}</span>
        </h2>

        <StepsBody summary={summary} stepGoal={stepGoal} />

        {ready && (
          <div className="apple-row health-source hl-source">
            <span className="category-tile" style={{ background: COLORS.steps }} aria-hidden="true"><Upload size={15} strokeWidth={2.4} /></span>
            <div>
              <strong>Apple Health</strong>
              <small>{summary.lastImport ? importedLine(summary.lastImport) : 'Not imported yet'}</small>
            </div>
            <input ref={input} type="file" accept=".zip,.xml,application/zip,text/xml,application/xml" hidden onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void importFile(file);
            }} />
            <button type="button" className="finance-button primary" disabled={busy} onClick={() => input.current?.click()}>
              {busy && <LoaderCircle size={13} className="spin" aria-hidden="true" />}
              {latest ? 'Import' : 'Upload export'}
            </button>
            {latest && !confirmDelete && <button type="button" className="icon-action hl-quiet-del" disabled={busy} onClick={() => setConfirmDelete(true)} aria-label="Delete step data"><Trash2 size={15} /></button>}
            {confirmDelete && (
              <div className="health-source-confirm">
                <span>Delete all imported step data?</span>
                <button type="button" className="finance-button danger" disabled={busy} onClick={deleteSteps}>Delete</button>
                <button type="button" className="finance-button secondary" disabled={busy} onClick={() => setConfirmDelete(false)}>Cancel</button>
              </div>
            )}
            <ImportProgress progress={progress} isSaving={isSaving} />
          </div>
        )}
        {message && <output className={`finance-notice ${message.tone}`}>{message.text}</output>}
      </section>

      {children}

      {ready && latest && (
        <section className="hl-trend" aria-labelledby="trend-title">
          <StepsChart summary={summary} latest={latest} span={span} onSpan={setSpan} />
          {summary.average30 !== null && summary.previous30 !== null && <TrendBars average30={summary.average30} previous30={summary.previous30} />}
        </section>
      )}
    </>
  );
}
