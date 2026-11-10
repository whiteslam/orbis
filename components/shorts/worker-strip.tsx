'use client';

import type { WorkerPresence, WorkerState } from '@/lib/shorts/types';

const AGO = new Intl.RelativeTimeFormat('en-IN', { numeric: 'auto' });

function ago(iso: string | null) {
  if (!iso) return null;
  const minutes = Math.round((new Date(iso).getTime() - Date.now()) / 60_000);
  if (!Number.isFinite(minutes)) return null;
  return Math.abs(minutes) < 60 ? AGO.format(minutes, 'minute') : AGO.format(Math.round(minutes / 60), 'hour');
}

const LINE: Record<WorkerPresence, string> = {
  none: 'Shorts are made by a small worker on your own PC, using Claude Code and the faceless-shorts skill.',
  setup: 'Your PC worker is running, but the skill isn’t ready yet.',
  offline: 'Your PC worker is offline. New shorts wait in the queue until it’s back.',
  idle: 'Your PC worker is online and ready.',
  busy: 'Your PC worker is making a short.',
  paused: 'Your PC worker has paused.',
};

/** Whether the PC that makes the shorts is there, and what to do when it isn't. */
export function WorkerStrip({ presence, worker }: Readonly<{ presence: WorkerPresence; worker: WorkerState | null }>) {
  const seen = ago(worker?.lastSeen ?? null);
  return (
    <section className={`sh-worker is-${presence}`} aria-label="PC worker">
      <p className="sh-worker-line" aria-live="polite">
        <i aria-hidden="true" />
        <span>
          {LINE[presence]}
          {presence === 'offline' && seen && <> Last seen {seen}.</>}
        </span>
      </p>
      {worker?.note && (presence === 'busy' || presence === 'paused' || presence === 'setup') && <p className="sh-worker-note">{worker.note}</p>}
      {(presence === 'none' || presence === 'offline' || presence === 'setup') && (
        <details className="sh-setup">
          <summary>{presence === 'none' ? 'Set up the worker' : 'How to start it'}</summary>
          <ol>
            <li>Install the faceless-shorts skill at <code>~/.claude/skills/faceless-shorts</code> and run its <code>scripts/setup.sh</code> until it prints “All set”.</li>
            <li>Sign in to Claude Code on that PC.</li>
            <li>Write <code>~/.config/orbis-shorts/.env</code> with your Supabase URL, service-role key and Orbis user id.</li>
            <li>Start it: <code>systemctl --user enable --now orbis-shorts</code>. The full steps are in <code>workers/shorts-studio/README.md</code>.</li>
          </ol>
        </details>
      )}
    </section>
  );
}
