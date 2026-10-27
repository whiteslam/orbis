'use client';

import { useState } from 'react';
import { ArrowLeft, CircleStop, LoaderCircle, RefreshCw } from 'lucide-react';
import { cancelResearchRunAction } from '@/app/research/actions';
import { DecisionCard } from '@/components/research/decision-card';
import { useResearchRun } from '@/components/research/use-research';
import { safeAction } from '@/lib/client/safe-action';
import { agentLabel, groupEvents, plainText, STAGE_LABELS, type Said } from '@/lib/research/timeline';
import { ACTIVE_STATUSES, type ResearchRun, type ResearchSettlement, type RunStatus } from '@/lib/research/types';

export const STATUS_LABELS: Record<RunStatus, string> = {
  queued: 'Queued',
  running: 'Working',
  done: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export function StatusChip({ status }: Readonly<{ status: RunStatus }>) {
  return <span className={`rd-status is-${status}`}>{STATUS_LABELS[status]}</span>;
}

function Report({ said, open }: Readonly<{ said: Said; open?: boolean }>) {
  return (
    <details className="rd-report" open={open}>
      <summary>{agentLabel(said.agent)}</summary>
      <p>{plainText(said.content)}</p>
    </details>
  );
}

function Turn({ said }: Readonly<{ said: Said }>) {
  return (
    <li className={`rd-turn is-${said.agent}`}>
      <b>{agentLabel(said.agent)}</b>
      <p>{plainText(said.content)}</p>
    </li>
  );
}

function costLine(run: ResearchRun) {
  const parts: string[] = [];
  if (run.tokens !== null) parts.push(`${Math.round(run.tokens / 1000).toLocaleString('en-IN')}k tokens`);
  if (run.costUsd !== null) parts.push(`$${run.costUsd.toFixed(2)}`);
  return parts.join(' · ');
}

/**
 * One run as the team worked it: reports as they finish, the Bull vs Bear
 * debate as a conversation, the trader's proposal, the risk debate and the
 * final call. Polls while the run is working; Cancel stops it at the next step.
 * `wide` lays the debate out side by side (the web panel).
 */
export function RunView({ runId, settlements, onBack, onRetry, wide = false }: Readonly<{
  runId: string;
  settlements: readonly ResearchSettlement[];
  onBack?: () => void;
  onRetry?: (run: ResearchRun) => void;
  wide?: boolean;
}>) {
  const { run, events, settlement, problem, reload } = useResearchRun(runId);
  const [stopping, setStopping] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const timeline = groupEvents(events);
  const active = run ? ACTIVE_STATUSES.includes(run.status) : true;

  const stop = async () => {
    setStopping(true);
    const result = await safeAction(cancelResearchRunAction)(runId);
    setStopping(false);
    setMessage(result.success ? null : result.message);
    reload();
  };

  const bull = timeline.debate.filter((said) => said.agent === 'bull');
  const bear = timeline.debate.filter((said) => said.agent === 'bear');

  return (
    <article className={`rd-run${wide ? ' is-wide' : ''}`} aria-busy={active}>
      <header className="rd-run-head">
        {onBack && (
          <button type="button" className="cr-btn" onClick={onBack}><ArrowLeft size={14} aria-hidden="true" />Back</button>
        )}
        <div className="rd-run-title">
          <h3>{run ? run.symbol : 'Loading the run…'}</h3>
          {run && <span>{run.ticker} · {run.tradeDate}{run.source === 'weekly' ? ' · weekly desk run' : ''}</span>}
        </div>
        {run && <StatusChip status={run.status} />}
      </header>

      {active && (
        <output className="rd-progress">
          <LoaderCircle className="workbook-spinner" size={14} aria-hidden="true" />
          {STAGE_LABELS[timeline.stage]}. A run takes 3 to 10 minutes; you can leave this page and come back.
        </output>
      )}
      {problem && <p className="fd-msg bad">{problem}</p>}
      {message && <p className="fd-msg bad">{message}</p>}
      {run?.status === 'failed' && <p className="rd-failed">{run.error ?? 'This run didn’t finish.'}</p>}
      {run?.status === 'cancelled' && <p className="rd-failed">You stopped this run. Nothing after that point was written.</p>}

      {run && <DecisionCard run={run} settlements={settlements} settlement={settlement} />}

      {timeline.reports.length > 0 && (
        <section className="rd-block">
          <h4>Analyst reports</h4>
          {timeline.reports.map((said) => <Report key={said.seq} said={said} />)}
        </section>
      )}

      {timeline.debate.length > 0 && (
        <section className="rd-block">
          <h4>Bull vs Bear</h4>
          {wide ? (
            <div className="rd-sides">
              <ol className="rd-convo">{bull.map((said) => <Turn key={said.seq} said={said} />)}</ol>
              <ol className="rd-convo">{bear.map((said) => <Turn key={said.seq} said={said} />)}</ol>
            </div>
          ) : (
            <ol className="rd-convo">{timeline.debate.map((said) => <Turn key={said.seq} said={said} />)}</ol>
          )}
          {timeline.plan && <Report said={{ seq: -1, agent: 'research_manager', content: timeline.plan, at: '' }} />}
        </section>
      )}

      {timeline.trader && (
        <section className="rd-block">
          <h4>The trader’s proposal</h4>
          <p className="rd-plain">{plainText(timeline.trader)}</p>
        </section>
      )}

      {timeline.risk.length > 0 && (
        <section className="rd-block">
          <h4>Risk debate</h4>
          <ol className="rd-convo">{timeline.risk.map((said) => <Turn key={said.seq} said={said} />)}</ol>
        </section>
      )}

      {timeline.decision && (
        <section className="rd-block">
          <Report said={{ seq: -2, agent: 'portfolio_manager', content: timeline.decision, at: '' }} />
        </section>
      )}

      {timeline.status.length > 0 && (
        <ul className="rd-notes">{timeline.status.map((said) => <li key={said.seq}>{said.content}</li>)}</ul>
      )}

      <footer className="rd-run-foot">
        {run && costLine(run) && <span>{costLine(run)}</span>}
        {run && active && (
          <button type="button" className="cr-btn" onClick={stop} disabled={stopping}>
            <CircleStop size={14} aria-hidden="true" />{stopping ? 'Stopping…' : 'Cancel run'}
          </button>
        )}
        {run && onRetry && (run.status === 'failed' || run.status === 'cancelled') && (
          <button type="button" className="cr-btn primary" onClick={() => onRetry(run)}>
            <RefreshCw size={14} aria-hidden="true" />Try again
          </button>
        )}
      </footer>
    </article>
  );
}
