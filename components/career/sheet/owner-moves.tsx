'use client';

import { useState } from 'react';
import { ArrowRightLeft } from 'lucide-react';
import { moveApplicationAction, ownerMovesAction } from '@/app/career/actions';
import { BusyIcon, NoticeLine } from '@/components/career/bits';
import { useRun } from '@/components/career/use-run';
import type { ApplicationStatus } from '@/lib/career/types';
import type { ApplicationDetail, OwnerMove } from '@/lib/career/view';

// Moves that close the application ask once first.
const CONFIRM: Partial<Record<ApplicationStatus, string>> = {
  withdrawn: 'Withdraw this application? Orbis stops watching for replies to it.',
  declined: 'Decline this offer? This closes the application.',
  rejected: 'Mark this as rejected?',
};

/**
 * What the owner may record by hand (Gmail can't see a phone screen, an offer
 * by call, or a withdrawal). The server says which moves are allowed from here.
 */
export function OwnerMoves({ applicationId, onDetail }: Readonly<{ applicationId: string; onDetail: (detail: ApplicationDetail) => void }>) {
  const [moves, setMoves] = useState<OwnerMove[] | null>(null);
  const { busy, notice, run } = useRun();

  const load = () => {
    if (moves) {
      setMoves(null);
      return;
    }
    void run('load', () => ownerMovesAction(applicationId), (next) => {
      setMoves(next);
      if (!next.length) return 'Nothing to change by hand from here.';
    });
  };

  const move = (to: OwnerMove) => {
    const ask = CONFIRM[to.to];
    if (ask && !window.confirm(ask)) return;
    void run(`move-${to.to}`, () => moveApplicationAction(applicationId, to.to), (detail) => {
      onDetail(detail);
      setMoves(null);
      return `Moved: ${to.label}.`;
    });
  };

  return (
    <section className="cr-block cr-moves" aria-labelledby="cr-moves-title">
      <h2 className="sr-only" id="cr-moves-title">Change status</h2>
      <button type="button" className="fd-button ghost" aria-expanded={moves !== null} onClick={load} disabled={busy !== null && busy !== 'load'}>
        <BusyIcon on={busy === 'load'}><ArrowRightLeft size={14} aria-hidden="true" /></BusyIcon>
        Record something that happened
      </button>
      {moves && moves.length > 0 && (
        <div className="cr-move-list">
          {moves.map((option) => (
            <button key={option.to} type="button" className={option.to === 'withdrawn' ? 'alert' : undefined} onClick={() => move(option)} disabled={busy !== null}>
              <BusyIcon on={busy === `move-${option.to}`} />
              {option.label}
            </button>
          ))}
        </div>
      )}
      <NoticeLine notice={notice} />
    </section>
  );
}
