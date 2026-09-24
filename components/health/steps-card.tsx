'use client';

import { useRef, useState, useTransition } from 'react';
import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Flame, LoaderCircle, Trash2, Upload } from 'lucide-react';
import { deleteHealthStepsAction, importAppleHealthStepsAction } from '@/app/health/steps-actions';
import { ActivityRings } from '@/components/health/activity-rings';
import type { StepsSummary } from '@/lib/health/types';
import type { WorkerMessage } from '@/components/health/apple-health.worker';

const number = (value: number) => Math.round(value).toLocaleString('en-IN');
const dayLabel = (date: string, options: Intl.DateTimeFormatOptions) => new Date(`${date}T00:00:00Z`).toLocaleDateString('en-IN', { ...options, timeZone: 'UTC' });
const shiftDate = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

// Apple Health's Activity colours: steps red-pink, average green, goal days cyan.
const COLORS = { steps: '#fa114f', average: '#34c759', streak: '#00b7d6', activity: '#fa5b30' };
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

export function StepsCard({ summary, stepGoal }: { summary: StepsSummary; stepGoal: number }) {
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [span, setSpan] = useState<number>(7);
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
        const saved = await importAppleHealthStepsAction({ fileName: file.name, recordCount: result.recordCount, days: result.days });
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
      const result = await deleteHealthStepsAction();
      setConfirmDelete(false);
      setMessage({ tone: result.success ? 'success' : 'error', text: result.message });
    });
  }

  const ready = summary.databaseReady && !summary.loadError;
  const latest = summary.latest;
  const week = series(summary, 7);
  const goalDays = week.filter((day) => day.steps >= stepGoal).length;
  const chart = series(summary, span);
  const recorded = chart.filter((day) => day.recorded);
  const rangeAverage = recorded.length ? recorded.reduce((sum, day) => sum + day.steps, 0) / recorded.length : 0;
  const trendUp = summary.average30 !== null && summary.previous30 !== null && summary.average30 >= summary.previous30;
  const trendMax = Math.max(summary.average30 ?? 0, summary.previous30 ?? 0, 1);

  return (
    <>
      {latest && (
        <section className="apple-card rings-card" aria-label="Activity summary">
          <ActivityRings rings={[
            { label: 'Steps', value: latest.steps / stepGoal, color: COLORS.steps, track: '#fde1e8' },
            { label: '7-day average', value: (summary.average7 ?? 0) / stepGoal, color: COLORS.average, track: '#dcf5e2' },
            { label: 'Goal days', value: goalDays / 7, color: COLORS.streak, track: '#d6f2f7' },
          ]} />
          <dl className="rings-legend">
            <div><dt style={{ color: COLORS.steps }}>Steps</dt><dd><b>{number(latest.steps)}</b>/{number(stepGoal)}</dd></div>
            <div><dt style={{ color: COLORS.average }}>7-day average</dt><dd><b>{number(summary.average7 ?? 0)}</b>/{number(stepGoal)}</dd></div>
            <div><dt style={{ color: COLORS.streak }}>Goal days</dt><dd><b>{goalDays}</b>/7</dd></div>
          </dl>
        </section>
      )}

      <h3 className="apple-section">Activity</h3>
      <section className="apple-card steps-card" aria-labelledby="steps-title">
        <header className="apple-card-head">
          <strong id="steps-title" style={{ color: COLORS.activity }}><Flame size={15} fill="currentColor" aria-hidden="true" />Steps</strong>
          {latest && <span>{dayLabel(latest.date, { day: 'numeric', month: 'short' })}</span>}
        </header>

        {!summary.databaseReady ? (
          <p className="apple-card-empty">Apply the Health steps migration (202609240012_health_steps.sql) in Supabase to import step data.</p>
        ) : summary.loadError ? (
          <p className="apple-card-empty">Step data could not be loaded. Refresh the app and try again.</p>
        ) : latest ? (
          <>
            <div className="apple-segmented" role="group" aria-label="Chart range">
              {RANGES.map(([label, days]) => <button key={label} type="button" aria-pressed={span === days} onClick={() => setSpan(days)}>{label}</button>)}
            </div>
            <p className="apple-metric-label">Daily average</p>
            <p className="apple-metric"><b>{number(rangeAverage)}</b> steps</p>
            <p className="apple-metric-range">{dayLabel(chart[0].date, { day: 'numeric', month: 'short' })} – {dayLabel(latest.date, { day: 'numeric', month: 'short', year: 'numeric' })}</p>
            <ResponsiveContainer width="100%" height={170}>
              <BarChart data={chart} margin={{ top: 8, right: 0, bottom: 0, left: 0 }} barCategoryGap={span > 30 ? 1 : '22%'}>
                <CartesianGrid vertical={false} stroke="#e5e5ea" strokeDasharray="2 3" />
                <XAxis dataKey="date" tickLine={false} axisLine={{ stroke: '#e5e5ea' }} tick={{ fontSize: 10, fill: '#8e8e93' }} interval={span === 7 ? 0 : span === 30 ? 6 : 29} tickFormatter={(date: string) => dayLabel(date, span === 7 ? { weekday: 'narrow' } : { day: 'numeric', month: span > 30 ? 'short' : undefined })} />
                <YAxis orientation="right" tickLine={false} axisLine={false} width={36} tick={{ fontSize: 10, fill: '#8e8e93' }} tickFormatter={(value: number) => (value >= 1000 ? `${Math.round(value / 1000)}k` : String(value))} />
                <Tooltip cursor={{ fill: 'rgba(250,91,48,.08)' }} formatter={(value) => [`${number(Number(value))} steps`, '']} separator="" labelFormatter={(date) => dayLabel(String(date), { weekday: 'short', day: 'numeric', month: 'short' })} />
                <ReferenceLine y={rangeAverage} stroke={COLORS.activity} strokeDasharray="3 3" strokeOpacity={0.7} />
                <Bar dataKey="steps" fill={COLORS.activity} radius={[3, 3, 0, 0]} maxBarSize={28} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </>
        ) : (
          <p className="apple-card-empty">
            Browsers can’t read Apple Health directly. On your iPhone, open <b>Health</b>, tap your profile picture, choose <b>Export All Health Data</b>, and upload the export.zip here. The file is read on this device, and only daily step totals are saved.
          </p>
        )}
      </section>

      {summary.average30 !== null && summary.previous30 !== null && (
        <>
          <h3 className="apple-section">Highlights</h3>
          <section className="apple-card highlight-card">
            <header className="apple-card-head"><strong style={{ color: COLORS.activity }}><Flame size={15} fill="currentColor" aria-hidden="true" />Steps</strong></header>
            <p className="highlight-text">
              {trendUp ? 'You’re averaging more steps over the last 30 days than the 30 days before.' : 'You’re averaging fewer steps over the last 30 days than the 30 days before.'}
            </p>
            <div className="highlight-bars">
              <div>
                <p><b>{number(summary.average30)}</b> steps/day</p>
                <i style={{ width: `${(summary.average30 / trendMax) * 100}%`, background: COLORS.activity }} />
                <small>Last 30 days</small>
              </div>
              <div>
                <p><b>{number(summary.previous30)}</b> steps/day</p>
                <i style={{ width: `${(summary.previous30 / trendMax) * 100}%`, background: '#c7c7cc' }} />
                <small>Previous 30 days</small>
              </div>
            </div>
          </section>
        </>
      )}

      {ready && (
        <section className="apple-row health-source">
          <span className="category-tile" style={{ background: COLORS.steps }} aria-hidden="true"><Upload size={15} strokeWidth={2.4} /></span>
          <div>
            <strong>Apple Health</strong>
            <small>
              {summary.lastImport
                ? `Imported ${new Date(summary.lastImport.importedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}${summary.lastImport.lastDate ? `, data up to ${dayLabel(summary.lastImport.lastDate, { day: 'numeric', month: 'short' })}` : ''}`
                : 'Not imported yet'}
            </small>
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
          {latest && !confirmDelete && <button type="button" className="icon-action" disabled={busy} onClick={() => setConfirmDelete(true)} aria-label="Delete step data"><Trash2 size={15} /></button>}
          {confirmDelete && (
            <div className="health-source-confirm">
              <span>Delete all imported step data?</span>
              <button type="button" className="finance-button danger" disabled={busy} onClick={deleteSteps}>Delete</button>
              <button type="button" className="finance-button secondary" disabled={busy} onClick={() => setConfirmDelete(false)}>Cancel</button>
            </div>
          )}
          {progress && (
            <div className="steps-progress" role="status">
              <span>{progress.stage}</span>
              <div><i style={{ width: `${Math.round(progress.fraction * 100)}%` }} /></div>
            </div>
          )}
          {isSaving && !progress && <p className="steps-progress" role="status">Saving daily totals…</p>}
        </section>
      )}
      {message && <p className={`finance-notice ${message.tone}`} role="status">{message.text}</p>}
    </>
  );
}
