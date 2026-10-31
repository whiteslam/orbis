'use client';

import { useState, type FormEvent } from 'react';
import { ArrowLeft, LoaderCircle, ScanSearch } from 'lucide-react';
import { saveResearchSettingsAction, startResearchAction } from '@/app/research/actions';
import { OrbisMark } from '@/components/brand/orbis-mark';
import { PanelCard, PanelEmpty } from '@/components/career/panel/panel-bits';
import { RatingChip, TrackRecordLine } from '@/components/research/decision-card';
import { RunView, StatusChip } from '@/components/research/run-view';
import { useResearchDesk } from '@/components/research/use-research';
import { safeAction } from '@/lib/client/safe-action';
import { trackRecord } from '@/lib/research/track';
import { RESEARCH_DISCLAIMER, SETTINGS_LIMITS, type ResearchSettings } from '@/lib/research/types';

/** Weekly run, top N, models and caps. Each change saves on its own, and a refused one says why. */
function SettingsCard({ settings, onSaved }: Readonly<{ settings: ResearchSettings; onSaved: (next: ResearchSettings) => void }>) {
  const [draft, setDraft] = useState(settings);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async (patch: Partial<ResearchSettings>) => {
    setSaving(true);
    const result = await safeAction(saveResearchSettingsAction)(patch);
    setSaving(false);
    if (!result.success) {
      setMessage(result.message);
      setDraft(settings);
      return;
    }
    setMessage(null);
    onSaved(result.data);
  };

  const number = (key: 'weeklyTopN' | 'runTokenCap' | 'monthlyRunCap', label: string) => (
    <label>
      {label}
      <input
        type="number"
        inputMode="numeric"
        min={SETTINGS_LIMITS[key].min}
        max={SETTINGS_LIMITS[key].max}
        value={draft[key]}
        onChange={(event) => setDraft({ ...draft, [key]: Number(event.currentTarget.value) })}
        onBlur={() => draft[key] !== settings[key] && void save({ [key]: draft[key] })}
        disabled={saving}
      />
    </label>
  );
  const model = (key: 'deepModel' | 'quickModel', label: string) => (
    <label>
      {label}
      <input
        type="text"
        value={draft[key]}
        spellCheck={false}
        onChange={(event) => setDraft({ ...draft, [key]: event.currentTarget.value.trim() })}
        onBlur={() => draft[key] !== settings[key] && void save({ [key]: draft[key] })}
        disabled={saving}
      />
    </label>
  );

  return (
    <PanelCard title="Settings">
      <div className="rd-settings">
        <label>
          Research desk on
          <input type="checkbox" role="switch" checked={draft.enabled} onChange={(event) => { const enabled = event.currentTarget.checked; setDraft({ ...draft, enabled }); void save({ enabled }); }} disabled={saving} />
        </label>
        <label>
          Weekly desk run (Saturday, top holdings)
          <input type="checkbox" role="switch" checked={draft.weeklyEnabled} onChange={(event) => { const weeklyEnabled = event.currentTarget.checked; setDraft({ ...draft, weeklyEnabled }); void save({ weeklyEnabled }); }} disabled={saving} />
        </label>
        {number('weeklyTopN', 'Holdings in the weekly run')}
        {number('monthlyRunCap', 'Runs a month, at most')}
        {number('runTokenCap', 'Tokens a run, at most')}
        {model('deepModel', 'Deep model (managers)')}
        {model('quickModel', 'Quick model (analysts, debate)')}
        {message && <output className="fd-msg bad">{message}</output>}
        <p className="fd-note">Models are OpenRouter ids. A run uses 15 to 25 model calls; the weekly run counts towards the monthly cap.</p>
      </div>
    </PanelCard>
  );
}

/**
 * The full Research desk at /active/research: every run on the left with the
 * track record and settings, the selected run on the right as a timeline of
 * the agents with the Bull vs Bear debate side by side. The page has already
 * checked the session, the allowlist, the lock, the PIN and the desk's own
 * owner list.
 */
export function ResearchPanel() {
  const { desk, problem, reload, setDesk } = useResearchDesk();
  const [selected, setSelected] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const start = async (ticker: string) => {
    setBusy(true);
    setMessage(null);
    const result = await safeAction(startResearchAction)({ ticker });
    setBusy(false);
    if (!result.success) return setMessage(result.message);
    setTyped('');
    setSelected(result.data.runId);
    reload();
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (typed.trim()) void start(typed);
  };

  let body;
  if (desk === null) {
    body = problem
      ? <PanelEmpty title="The Research desk didn’t load." action={<button type="button" className="cr-btn primary" onClick={reload}>Try again</button>}>{problem}</PanelEmpty>
      : <output className="cp-loading">Loading the Research desk…</output>;
  } else if (desk === false) {
    body = <PanelEmpty title="The Research desk isn’t available on this account." />;
  } else {
    const current = selected ?? desk.runs[0]?.id ?? null;
    const record = trackRecord(desk.settlements);
    body = (
      <div className="rd-grid">
        <div className="rd-side">
          <PanelCard title="New analysis">
            <form className="rd-typed" onSubmit={submit}>
              <label htmlFor="rd-panel-ticker">Any NSE or BSE ticker</label>
              <div>
                <input id="rd-panel-ticker" value={typed} onChange={(event) => setTyped(event.currentTarget.value)} placeholder="RELIANCE, NSE:INFY, BSE:500325" maxLength={40} autoComplete="off" spellCheck={false} />
                <button type="submit" className="cr-btn primary" disabled={busy || !typed.trim() || !desk.configured}>
                  {busy ? <LoaderCircle className="workbook-spinner" size={14} aria-hidden="true" /> : <ScanSearch size={14} aria-hidden="true" />}Analyse
                </button>
              </div>
            </form>
            {!desk.configured && <p className="fd-hint">The research worker isn’t set up on this server yet, so runs can’t start.</p>}
            {message && <output className="fd-msg bad">{message}</output>}
            <p className="rd-track">{desk.monthUsed} of {desk.settings.monthlyRunCap} runs this month. Holdings are on Money → Investments.</p>
          </PanelCard>

          <PanelCard title="Track record">
            <TrackRecordLine settlements={desk.settlements} />
            {record.count > 0 && (
              <ul className="rd-panel-runs">
                {desk.settlements.slice(0, 12).map((item) => (
                  <li key={item.runId}>
                    <button type="button" onClick={() => setSelected(item.runId)} aria-current={item.runId === current}>
                      <span>{item.ticker}<small>{item.tradeDate} · alpha {item.alphaPct >= 0 ? '+' : '−'}{Math.abs(item.alphaPct).toFixed(1)}%</small></span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </PanelCard>

          <PanelCard title="Runs">
            {desk.runs.length === 0 ? <p className="rd-track">No runs yet. Start one above or from Money → Investments.</p> : (
              <ul className="rd-panel-runs">
                {desk.runs.map((run) => (
                  <li key={run.id}>
                    <button type="button" onClick={() => setSelected(run.id)} aria-current={run.id === current}>
                      <span>{run.symbol}<small>{run.tradeDate}{run.source === 'weekly' ? ' · weekly' : ''}</small></span>
                      {run.decision && run.status === 'done' ? <RatingChip rating={run.decision.rating} /> : <StatusChip status={run.status} />}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </PanelCard>

          <SettingsCard key={JSON.stringify(desk.settings)} settings={desk.settings} onSaved={(settings) => setDesk({ ...desk, settings })} />
        </div>

        <div className="rd-main">
          {current
            ? <PanelCard title="The run"><RunView key={current} runId={current} settlements={desk.settlements} wide onRetry={(run) => void start(run.ticker)} /></PanelCard>
            : <PanelEmpty title="Pick a stock to research.">Type an NSE or BSE ticker, or press Deep analysis on a holding in Money → Investments. A team of AI agents researches it, debates it and ends in a call.</PanelEmpty>}
          <p className="cp-foot-note">{RESEARCH_DISCLAIMER} Orbis never places or stages an order.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="cp-panel rd-panel">
      <div className="cp-wall" aria-hidden="true" />
      <div className="cp-frame">
        <header className="rd-panel-head">
          <a className="cp-brand" href="/active"><OrbisMark size={26} />Orbis</a>
          <a className="cr-btn" href="/active#money/investments"><ArrowLeft size={14} aria-hidden="true" />Investments</a>
        </header>
        <main id="cp-main" className="cp-main" tabIndex={-1} aria-labelledby="rd-title">
          <div className="cp-titlerow">
            <h1 id="rd-title"><span>Research</span><span>desk</span></h1>
          </div>
          {body}
        </main>
      </div>
    </div>
  );
}
