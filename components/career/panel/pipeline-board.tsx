'use client';

import type { DragEvent } from 'react';
import { Archive, BadgeCheck, LoaderCircle } from 'lucide-react';
import { dayMonth, rangeText } from '@/components/career/format';
import { ScoreRing } from '@/components/career/score-ring';
import { StatusChip } from '@/components/career/status-chip';
import { MoveMenu } from '@/components/career/panel/move-menu';
import { isOpen, STAGE_GROUPS } from '@/lib/career/status';
import type { ApplicationStatus, CareerEvent } from '@/lib/career/types';
import type { ApplicationCard, OwnerMove, Result } from '@/lib/career/view';

export type Lane = { id: string; label: string; statuses: readonly ApplicationStatus[]; zone: boolean };

const BOARD_IDS = new Set(['ready', 'sent', 'replied', 'interview', 'offer']);

/** Ready → Sent → Replied → Interview → Offer, then the Accepted and Closed drop zones. */
export const LANES: readonly Lane[] = [
  ...STAGE_GROUPS.filter((group) => BOARD_IDS.has(group.id)).map((group) => ({ id: group.id, label: group.label, statuses: group.statuses, zone: false })),
  { id: 'accepted', label: 'Accepted', statuses: ['accepted'], zone: true },
  { id: 'closed', label: 'Closed', statuses: ['declined', 'rejected', 'withdrawn', 'ghosted', 'failed'], zone: true },
];

export function laneOf(status: ApplicationStatus): Lane {
  return LANES.find((lane) => lane.statuses.includes(status)) ?? LANES[LANES.length - 1];
}

/** What a dragged card may do, once the server has said. */
export type DragState = { id: string; from: string; moves: OwnerMove[] | null; error: string | null };

export type BoardCard = ApplicationCard & { status: ApplicationStatus; latest: CareerEvent | null };

export type CardHandlers = {
  prefetch: (card: BoardCard) => void;
  loadMoves: (card: BoardCard) => Promise<Result<OwnerMove[]>>;
  onMove: (card: BoardCard, move: OwnerMove) => void;
  onOpen: (card: BoardCard) => void;
  onDragStart: (card: BoardCard, event: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
};

/** One application on the board, in its stage's colour, with its menu for everything a drag can do. */
function PipelineCard({ card, handlers, moving, flash }: Readonly<{ card: BoardCard; handlers: CardHandlers; moving: boolean; flash: boolean }>) {
  const { job, application, latest } = card;
  const lane = laneOf(card.status);
  const chance = application.prediction && isOpen(card.status) ? rangeText(application.prediction.replyRange) : null;
  const titleId = `cp-card-${application.id}`;
  return (
    <li>
      <article
        className={`cp-kcard cp-fill-${lane.id}${moving ? ' moving' : ''}${flash ? ' flash' : ''}`}
        aria-labelledby={titleId}
        draggable={!moving}
        onDragStart={(event) => handlers.onDragStart(card, event)}
        onDragEnd={handlers.onDragEnd}
        onPointerEnter={() => handlers.prefetch(card)}
      >
        <div className="cp-kcard-top">
          <StatusChip status={card.status} />
          {moving ? <LoaderCircle className="cr-spin" size={16} aria-label="Moving" /> : (
            <MoveMenu title={`${job.title}, ${job.company}`} loadMoves={() => handlers.loadMoves(card)} onMove={(move) => handlers.onMove(card, move)} onOpen={() => handlers.onOpen(card)} />
          )}
        </div>
        <h3 id={titleId}><button type="button" onClick={() => handlers.onOpen(card)}>{job.title}</button></h3>
        <p className="cp-kcard-company">{job.company}</p>
        <div className="cp-kcard-mid">
          <ScoreRing score={job.score} size="sm" lowConfidence={job.thin} />
          <p>{chance ? <><b>{chance}</b><small>reply chance{application.prediction?.early ? ', early' : ''}</small></> : <small>{job.location ?? (job.remote ? 'Remote' : 'Location not given')}</small>}</p>
        </div>
        {latest && (
          <p className="cp-kcard-last"><span>{latest.summary}</span><time dateTime={latest.at}>{dayMonth(latest.at)}</time></p>
        )}
      </article>
    </li>
  );
}

function laneState(lane: Lane, drag: DragState | null): string {
  if (!drag || drag.from === lane.id) return '';
  if (drag.error) return ' cannot';
  if (!drag.moves) return ' pending';
  return drag.moves.some((move) => lane.statuses.includes(move.to)) ? ' can' : ' cannot';
}

function LaneHint({ lane, drag }: Readonly<{ lane: Lane; drag: DragState | null }>) {
  const state = laneState(lane, drag).trim();
  if (!state) return null;
  const text: Record<string, string> = { can: 'Drop here', cannot: 'Not allowed', pending: 'Checking…' };
  return <span className={`cp-lane-hint ${state}`}>{text[state]}</span>;
}

export type DropHandlers = {
  onOver: (lane: Lane) => void;
  onLeave: (lane: Lane) => void;
  onDrop: (lane: Lane) => void;
};

function dropProps(lane: Lane, drag: DragState | null, drop: DropHandlers) {
  return {
    onDragOver: (event: DragEvent<HTMLElement>) => {
      if (!drag) return;
      // Every lane accepts the drop; an invalid one snaps the card back and says why.
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      drop.onOver(lane);
    },
    onDragLeave: (event: DragEvent<HTMLElement>) => {
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
      drop.onLeave(lane);
    },
    onDrop: (event: DragEvent<HTMLElement>) => {
      event.preventDefault();
      drop.onDrop(lane);
    },
  };
}

/** The kanban: five stage columns, then the two drop zones. */
export function PipelineBoard({ cards, drag, over, moving, flash, handlers, drop, onZone }: Readonly<{
  cards: BoardCard[];
  drag: DragState | null;
  over: string | null;
  moving: string | null;
  flash: string | null;
  handlers: CardHandlers;
  drop: DropHandlers;
  onZone: (lane: Lane) => void;
}>) {
  const columns = LANES.filter((lane) => !lane.zone);
  const zones = LANES.filter((lane) => lane.zone);
  return (
    <div className={`cp-board${drag ? ' dragging' : ''}`}>
      {columns.map((lane) => {
        const inLane = cards.filter((card) => lane.statuses.includes(card.status));
        return (
          <section key={lane.id} className={`cp-lane cp-stage-${lane.id}${laneState(lane, drag)}${over === lane.id ? ' over' : ''}`} aria-labelledby={`cp-lane-${lane.id}`} {...dropProps(lane, drag, drop)}>
            <header className="cp-lane-head">
              <i className={`cp-dot cp-fill-${lane.id}`} aria-hidden="true" />
              <h2 id={`cp-lane-${lane.id}`}>{lane.label}</h2>
              <span className="cp-lane-n">{inLane.length}</span>
              <LaneHint lane={lane} drag={drag} />
            </header>
            {inLane.length === 0 ? <p className="cp-lane-empty">Nothing here</p> : (
              <ol className="cp-lane-list">
                {inLane.map((card) => <PipelineCard key={card.application.id} card={card} handlers={handlers} moving={moving === card.application.id} flash={flash === card.application.id} />)}
              </ol>
            )}
          </section>
        );
      })}
      <div className="cp-zones">
        {zones.map((lane) => {
          const count = cards.filter((card) => lane.statuses.includes(card.status)).length;
          const Icon = lane.id === 'accepted' ? BadgeCheck : Archive;
          return (
            <section key={lane.id} className={`cp-zone cp-zone-${lane.id}${laneState(lane, drag)}${over === lane.id ? ' over' : ''}`} aria-labelledby={`cp-lane-${lane.id}`} {...dropProps(lane, drag, drop)}>
              <span className="cp-zone-disc" aria-hidden="true"><Icon size={20} /></span>
              <h2 id={`cp-lane-${lane.id}`}>{lane.label}</h2>
              <p>{lane.id === 'accepted' ? 'Offers you took' : 'Rejected, withdrawn, declined or no reply'}</p>
              <button type="button" className="cp-zone-count" onClick={() => onZone(lane)} disabled={count === 0}>
                {count === 0 ? 'None yet' : `Show ${count}`}
              </button>
              <LaneHint lane={lane} drag={drag} />
            </section>
          );
        })}
      </div>
    </div>
  );
}
