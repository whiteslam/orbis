'use client';

import { useId, useMemo, useRef, useState, type DragEvent } from 'react';
import { FileDown, Search } from 'lucide-react';
import { exportTrackerAction } from '@/app/career/actions';
import { BusyIcon, NoticeLine } from '@/components/career/bits';
import { dayMonth, rangeText, SOURCE_NAME } from '@/components/career/format';
import { StatusChip } from '@/components/career/status-chip';
import { useRun, type Notice } from '@/components/career/use-run';
import { MiniSwitch, PanelEmpty, useDialogFocus } from '@/components/career/panel/panel-bits';
import { usePanel } from '@/components/career/panel/panel-context';
import { allApplications, latestEvents } from '@/components/career/panel/panel-data';
import { datedName, downloadText } from '@/components/career/panel/panel-hooks';
import { MoveMenu } from '@/components/career/panel/move-menu';
import { LANES, PipelineBoard, laneOf, type BoardCard, type CardHandlers, type DragState, type DropHandlers, type Lane } from '@/components/career/panel/pipeline-board';
import { CONFIRM_MOVES, useMoveCache } from '@/components/career/panel/use-moves';
import { StageStrip } from '@/components/career/attention';
import { STAGE_GROUPS, groupOf, isOpen, type StageGroupId } from '@/lib/career/status';
import type { ApplicationStatus, SourceId } from '@/lib/career/types';
import type { CareerHome, OwnerMove } from '@/lib/career/view';

type View = 'board' | 'list';
const VIEWS: ReadonlyArray<readonly [View, string]> = [['list', 'List'], ['board', 'Board']];

const CONFIRM_TEXT: Partial<Record<ApplicationStatus, string>> = {
  withdrawn: 'Orbis stops watching for replies to it.',
  declined: 'This answers the offer and closes the application.',
  accepted: 'This answers the offer. Orbis stops watching the other replies only if you close them too.',
  rejected: 'Use this when they told you outside Gmail.',
};

type Confirm = { card: BoardCard; lane: string; options: OwnerMove[] };

/** Asked before a move that closes an application or answers an offer, and when a drop allows more than one move. */
function ConfirmMove({ confirm, onPick, onCancel }: Readonly<{ confirm: Confirm; onPick: (move: OwnerMove) => void; onCancel: () => void }>) {
  const box = useRef<HTMLDivElement | null>(null);
  useDialogFocus(box, onCancel);
  const { job } = confirm.card;
  const single = confirm.options.length === 1 ? confirm.options[0] : null;
  return (
    <div className="cp-veil" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
      <div className="cp-confirm" ref={box} role="alertdialog" aria-modal="true" aria-labelledby="cp-confirm-title" aria-describedby="cp-confirm-body">
        <h2 id="cp-confirm-title">{single ? `${single.label}?` : `Move to ${confirm.lane}`}</h2>
        <p id="cp-confirm-body">
          <b>{job.title}</b>, {job.company}. {single ? CONFIRM_TEXT[single.to] ?? '' : 'Choose what happened.'}
        </p>
        <div className="cp-confirm-acts">
          {confirm.options.map((move) => (
            <button key={move.to} type="button" className={`cr-btn ${move.to === 'withdrawn' || move.to === 'declined' ? 'danger' : 'primary'}`} onClick={() => onPick(move)}>{move.label}</button>
          ))}
          <button type="button" className="cr-btn" onClick={onCancel} data-autofocus>Cancel</button>
        </div>
      </div>
    </div>
  );
}

/** One application as a row: what it is, where it stands, its odds, its latest news, and its menu. */
function PipelineRow({ card, handlers }: Readonly<{ card: BoardCard; handlers: CardHandlers }>) {
  const prediction = card.application.prediction;
  const chance = prediction && isOpen(card.status) ? rangeText(prediction.replyRange) : null;
  return (
    <li className="cp-row">
      <button type="button" className="cp-row-open" onClick={() => handlers.onOpen(card)}>
        <b>{card.job.title}</b>
        <small>{card.job.company}</small>
      </button>
      <span className="cp-row-stage"><StatusChip status={card.status} /></span>
      <span className="cp-row-num" title="Match score"><b>{card.job.score ?? '–'}</b><small>match</small></span>
      <span className="cp-row-num" title="Reply chance">{chance ? <><b>{chance}</b><small>reply chance{prediction?.early ? ', early' : ''}</small></> : <small>{isOpen(card.status) ? 'Reply chance once more are out' : ''}</small>}</span>
      <span className="cp-row-latest">{card.latest ? <><span>{card.latest.summary}</span><time dateTime={card.latest.at}>{dayMonth(card.latest.at)}</time></> : <span className="none">No news yet</span>}</span>
      <span className="cp-row-menu"><MoveMenu title={`${card.job.title}, ${card.job.company}`} loadMoves={() => handlers.loadMoves(card)} onMove={(move) => handlers.onMove(card, move)} onOpen={() => handlers.onOpen(card)} /></span>
    </li>
  );
}

/** List view: every application as a row, grouped under its stage, with the same menu as the board's cards. */
function PipelineList({ cards, handlers }: Readonly<{ cards: BoardCard[]; handlers: CardHandlers }>) {
  return (
    <div className="cp-rows">
      {LANES.map((lane) => {
        const inLane = cards.filter((card) => lane.statuses.includes(card.status));
        if (!inLane.length) return null;
        return (
          <section key={lane.id} className={`cp-rowgroup cr-stage-${lane.id === 'accepted' ? 'offer' : lane.id}`} aria-labelledby={`cp-rows-${lane.id}`}>
            <h2 id={`cp-rows-${lane.id}`}><span className={`cp-dot cp-fill-${lane.id}`} aria-hidden="true" />{lane.label}<span>{inLane.length}</span></h2>
            <ul>{inLane.map((card) => <PipelineRow key={card.application.id} card={card} handlers={handlers} />)}</ul>
          </section>
        );
      })}
    </div>
  );
}

function explainNo(card: BoardCard, lane: Lane, allowed: OwnerMove[]): string {
  const head = `${card.job.company} can’t go to ${lane.label} by hand.`;
  if (!allowed.length) return `${head} Nothing changes by hand from ${laneOf(card.status).label}; Gmail moves it on as replies come in.`;
  return `${head} From here you can: ${allowed.map((move) => move.label).join(', ')}.`;
}

/** The board's state: filters, the drag in flight, moves made but not yet reloaded. */
function usePipeline(home: CareerHome) {
  const { services, reload } = usePanel();
  const moves = useMoveCache(services, home);
  const [overrides, setOverrides] = useState<{ home: CareerHome; map: Map<string, ApplicationStatus> }>({ home, map: new Map() });
  const [drag, setDrag] = useState<DragState | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  // A reload brings the server's truth; local guesses from before it are dropped.
  const live = overrides.home === home ? overrides.map : new Map<string, ApplicationStatus>();

  const snapBack = (id: string, text: string) => {
    setNotice({ text, ok: false });
    setFlash(id);
    setTimeout(() => setFlash((current) => (current === id ? null : current)), 700);
  };

  const doMove = async (card: BoardCard, move: OwnerMove) => {
    const id = card.application.id;
    setOverrides({ home, map: new Map(live).set(id, move.to) });
    setMoving(id);
    const result = await moves.move(id, move.to);
    setMoving(null);
    if (!result.success) {
      setOverrides((current) => {
        const map = new Map(current.map);
        map.delete(id);
        return { home: current.home, map };
      });
      snapBack(id, `${card.job.company} stayed where it was: ${result.message}`);
      return;
    }
    setNotice({ text: `${card.job.company}: ${move.label}.`, ok: true });
    reload();
  };

  const request = (card: BoardCard, options: OwnerMove[], lane: string) => {
    if (options.length === 1 && !CONFIRM_MOVES.has(options[0].to)) void doMove(card, options[0]);
    else setConfirm({ card, options, lane });
  };

  const dropOn = async (lane: Lane, state: DragState, card: BoardCard) => {
    if (state.from === lane.id) return;
    const result = await moves.get(state.id);
    if (!result.success) {
      snapBack(state.id, `Moves aren’t available right now: ${result.message}`);
      return;
    }
    const options = result.data.filter((move) => lane.statuses.includes(move.to));
    if (!options.length) {
      snapBack(state.id, explainNo(card, lane, result.data));
      return;
    }
    request(card, options, lane.label);
  };

  return { moves, live, drag, setDrag, over, setOver, moving, flash, confirm, setConfirm, notice, setNotice, doMove, request, dropOn };
}

/** Pipeline: the kanban (or a table), with search, a source filter and the CSV. */
export function PipelinePage({ home, initialSearch = '', initialStage = '' }: Readonly<{ home: CareerHome; initialSearch?: string; initialStage?: string }>) {
  const { openJob } = usePanel();
  const searchId = useId();
  const sourceId = useId();
  const [view, setView] = useState<View>('list');
  const [stage, setStage] = useState<StageGroupId | null>(STAGE_GROUPS.some((group) => group.id === initialStage) ? (initialStage as StageGroupId) : null);
  const [search, setSearch] = useState(initialSearch);
  const [source, setSource] = useState<SourceId | ''>('');
  const [zone, setZone] = useState<string | null>(null);
  const pipe = usePipeline(home);
  const csv = useRun();

  const all = useMemo(() => {
    const latest = latestEvents(home);
    return allApplications(home).map((card): BoardCard => ({ ...card, status: card.application.status, latest: latest.get(card.application.id) ?? null }));
  }, [home]);
  const sources = [...new Set(all.map((card) => card.job.source))];
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  const cards = all
    .map((card) => ({ ...card, status: pipe.live.get(card.application.id) ?? card.status }))
    .filter((card) => !source || card.job.source === source)
    .filter((card) => !stage || groupOf(card.status) === stage)
    .filter((card) => words.every((word) => `${card.job.title} ${card.job.company}`.toLowerCase().includes(word)));
  const draggedCard = useRef<BoardCard | null>(null);

  const handlers: CardHandlers = {
    prefetch: (card) => void pipe.moves.get(card.application.id),
    loadMoves: (card) => pipe.moves.get(card.application.id),
    onMove: (card, move) => pipe.request(card, [move], laneOf(move.to).label),
    onOpen: (card) => openJob(card.job, card),
    onDragStart: (card, event: DragEvent<HTMLElement>) => {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', card.application.id);
      draggedCard.current = card;
      const id = card.application.id;
      pipe.setNotice(null);
      pipe.setDrag({ id, from: laneOf(card.status).id, moves: null, error: null });
      void pipe.moves.get(id).then((result) => pipe.setDrag((current) => {
        if (current?.id !== id) return current;
        return result.success ? { ...current, moves: result.data } : { ...current, moves: [], error: result.message };
      }));
    },
    onDragEnd: () => {
      pipe.setDrag(null);
      pipe.setOver(null);
    },
  };

  const drop: DropHandlers = {
    onOver: (lane) => pipe.setOver(lane.id),
    onLeave: (lane) => pipe.setOver((current) => (current === lane.id ? null : current)),
    onDrop: (lane) => {
      const state = pipe.drag;
      const card = draggedCard.current;
      pipe.setDrag(null);
      pipe.setOver(null);
      if (state && card) void pipe.dropOn(lane, state, card);
    },
  };

  const download = () => csv.run('csv', () => exportTrackerAction(), (text) => {
    downloadText(text, datedName('orbis-career-tracker'));
    return 'Downloaded the tracker as a CSV file.';
  });

  const zoneLane = LANES.find((lane) => lane.id === zone) ?? null;
  const zoneCards = zoneLane ? cards.filter((card) => zoneLane.statuses.includes(card.status)) : [];

  if (all.length === 0) {
    return <PanelEmpty title="No applications yet.">When Orbis drafts one for a match, it appears here in Ready. Send it and it moves along the board as replies come in.</PanelEmpty>;
  }

  return (
    <div className="cp-pipeline">
      <StageStrip cards={all.map((card) => ({ ...card, application: { ...card.application, status: pipe.live.get(card.application.id) ?? card.status } }))} onPick={(id) => setStage((current) => (current === id ? null : id))} active={stage} label="Show one stage" />
      {stage && (
        <p className="cp-filter-line">
          Showing {STAGE_GROUPS.find((group) => group.id === stage)?.label.toLowerCase()} only. <button type="button" className="cp-link" onClick={() => setStage(null)}>Show all stages</button>
        </p>
      )}
      <div className="cp-toolbar">
        <div className="cp-search">
          <Search size={16} aria-hidden="true" />
          <label htmlFor={searchId} className="sr-only">Search applications</label>
          <input id={searchId} type="search" value={search} placeholder="Search by role or company" onChange={(event) => setSearch(event.currentTarget.value)} />
        </div>
        <label className="cp-select" htmlFor={sourceId}>
          <span className="sr-only">Source</span>
          <select id={sourceId} value={source} onChange={(event) => setSource(event.currentTarget.value as SourceId | '')}>
            <option value="">All sources</option>
            {sources.map((id) => <option key={id} value={id}>{SOURCE_NAME[id]}</option>)}
          </select>
        </label>
        <span className="cp-toolbar-gap" />
        <MiniSwitch label="Layout" value={view} options={VIEWS} onChange={setView} />
        <button type="button" className="cp-tool-btn" onClick={download} disabled={csv.busy !== null}>
          <BusyIcon on={csv.busy === 'csv'} size={16}><FileDown size={16} aria-hidden="true" /></BusyIcon>
          {csv.busy === 'csv' ? 'Preparing…' : 'CSV'}
        </button>
      </div>
      <NoticeLine notice={csv.notice} onDismiss={() => csv.setNotice(null)} />
      <NoticeLine notice={pipe.notice} onDismiss={() => pipe.setNotice(null)} />
      {view === 'board' && <p className="cp-board-help">Drag a card to record what happened, or use its <span className="sr-only">actions</span> menu. Only the moves you can make by hand are offered; Gmail moves cards forward by itself.</p>}
      {cards.length === 0 && <p className="cp-quiet">No applications match. Clear the search or pick another stage.</p>}
      {cards.length > 0 && view === 'board' && (
        <PipelineBoard cards={cards} drag={pipe.drag} over={pipe.over} moving={pipe.moving} flash={pipe.flash} handlers={handlers} drop={drop} onZone={(lane) => setZone((current) => (current === lane.id ? null : lane.id))} />
      )}
      {cards.length > 0 && view === 'list' && <PipelineList cards={cards} handlers={handlers} />}
      {view === 'board' && zoneLane && zoneCards.length > 0 && (
        <section className="cp-closed" aria-labelledby="cp-closed-title">
          <div className="cp-card-head"><h2 id="cp-closed-title">{zoneLane.label}</h2><button type="button" className="cp-link" onClick={() => setZone(null)}>Hide</button></div>
          <PipelineList cards={zoneCards} handlers={handlers} />
        </section>
      )}
      {pipe.confirm && (
        <ConfirmMove
          confirm={pipe.confirm}
          onCancel={() => pipe.setConfirm(null)}
          onPick={(move) => {
            const card = pipe.confirm?.card;
            pipe.setConfirm(null);
            if (card) void pipe.doMove(card, move);
          }}
        />
      )}
    </div>
  );
}
