// The mocked end-to-end: a press queues a run, GitHub is asked to start the
// worker, a fake worker writes what the Python one writes (the same columns,
// the same conditional status changes as research_desk/writer.py), and the
// rows read back through rows.ts, groupEvents and trackRecord into what the
// card shows. No network and no Supabase; the Playwright suite would need both.

import { test } from 'vitest';
import assert from 'node:assert/strict';
import { dispatchRuns, type DispatchConfig } from './dispatch';
import { cancelRun, queueRuns, type NewRunRow, type QueueDb } from './queue';
import { effectiveStatus, readEvent, readRun, readSettlement } from './rows';
import { groupEvents, positionLine, STAGE_LABELS } from './timeline';
import { trackRecord } from './track';
import { DEFAULT_RESEARCH_SETTINGS, type ResearchEvent, type ResearchRun, type ResearchSettlement } from './types';

const CONFIG: DispatchConfig = { token: 'github_pat_test', repo: 'owner/orbis-research-worker', workflow: 'research-desk.yml', ref: 'main' };
const USER = 'user-1';
const NOW = new Date('2026-10-27T04:00:00Z');

type Row = Record<string, unknown>;

/** The three tables as PostgREST would hand them back (numerics as strings). */
function fakeDatabase() {
  const runs: Row[] = [];
  const events: Row[] = [];
  const settlements: Row[] = [];
  const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000).toISOString();

  // Conditional update, like PostgREST's `?status=eq.queued`: returns the rows it changed.
  const update = (runId: string, from: readonly string[] | null, patch: Row) => {
    const row = runs.find((candidate) => candidate.id === runId);
    if (!row || (from && !from.includes(String(row.status)))) return [];
    Object.assign(row, patch);
    return [row];
  };

  const queueDb: QueueDb = {
    countRunsSince: async (userId, sinceIso) => runs.filter((row) => row.user_id === userId && String(row.created_at) >= sinceIso).length,
    activeTickers: async (userId) => runs.filter((row) => row.user_id === userId && ['queued', 'running'].includes(String(row.status))).map((row) => String(row.ticker)),
    insertRun: async (row: NewRunRow) => {
      const id = `00000000-0000-4000-8000-00000000000${runs.length + 1}`;
      runs.push({ ...row, id, decision: null, cost_usd: null, tokens: null, error: null, dispatched_at: null, started_at: null, finished_at: null, created_at: NOW.toISOString() });
      return id;
    },
    markDispatched: async (ids) => { for (const id of ids) update(id, ['queued'], { dispatched_at: NOW.toISOString() }); },
    markFailed: async (ids, message) => { for (const id of ids) update(id, ['queued'], { status: 'failed', error: message.slice(0, 500), finished_at: NOW.toISOString() }); },
    cancel: async (userId, runId) => {
      const row = runs.find((candidate) => candidate.id === runId && candidate.user_id === userId);
      return Boolean(row) && update(runId, ['queued', 'running'], { status: 'cancelled', finished_at: NOW.toISOString() }).length > 0;
    },
  };

  /** What research_desk/writer.py's RunWriter does, against the same rows. */
  function worker(runId: string) {
    let seq = 0;
    return {
      claim: () => update(runId, ['queued'], { status: 'running', started_at: at(1) }).length > 0,
      emit(agent: string, kind: string, content: string) {
        seq += 1;
        events.push({ user_id: USER, run_id: runId, seq, agent, kind, content, at: at(1 + seq) });
      },
      cancelled: () => runs.find((row) => row.id === runId)?.status === 'cancelled',
      finish: (decision: Row, usage: { input_tokens: number; output_tokens: number; cost_usd: number }) => update(runId, ['running'], {
        status: 'done',
        decision,
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
        tokens: usage.input_tokens + usage.output_tokens,
        cost_usd: usage.cost_usd.toFixed(6),
        finished_at: at(9),
      }).length > 0,
    };
  }

  // The reads repository.ts makes, through the same shape checks.
  const readRuns = () => runs.map(readRun).filter((run): run is ResearchRun => run !== null);
  const readEvents = (runId: string, afterSeq = 0) => events
    .filter((row) => row.run_id === runId && Number(row.seq) > afterSeq)
    .map(({ seq, agent, kind, content, at: when }) => readEvent({ seq, agent, kind, content, at: when }))
    .filter((event): event is ResearchEvent => event !== null);
  const readSettlements = () => settlements.map(readSettlement).filter((row): row is ResearchSettlement => row !== null);

  return { runs, events, settlements, queueDb, worker, readRuns, readEvents, readSettlements };
}

function fakeGitHub(status = 204) {
  const bodies: Array<{ ref: string; inputs: Record<string, string> }> = [];
  const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    return new Response(null, { status });
  }) as typeof fetch;
  return { bodies, fetchImpl };
}

const reliance = { ok: true as const, ticker: 'RELIANCE.NS', exchange: 'NSE' as const, symbol: 'RELIANCE' };
const input = {
  userId: USER,
  targets: [reliance],
  portfolio: { currency: 'INR' as const, cash: null, positions: [{ ticker: 'RELIANCE.NS', quantity: 20, average_price: 2600 }] },
  settings: DEFAULT_RESEARCH_SETTINGS,
  source: 'manual' as const,
  now: NOW,
};

const FINAL = '**Rating**: Overweight\n\n**Executive Summary**: Add on dips; margins are recovering.\n\n**Price Target**: ₹3,200';
const TRADER = '**Action**: Buy\n\n**Entry Price**: ₹2,880\n\n**Stop Loss**: ₹2,700';

test('a press becomes a queued run, one dispatch, a live timeline, a call and a track record', async () => {
  const db = fakeDatabase();
  const github = fakeGitHub();

  // 1. The press: the run is queued and the private repo's workflow is started with its id.
  const queued = await queueRuns({ db: db.queueDb, dispatch: (dispatch) => dispatchRuns(dispatch, { config: CONFIG, fetch: github.fetchImpl }), configured: true }, input);
  assert.equal(queued.ok, true);
  const runId = queued.ok ? queued.runIds[0] : '';
  assert.deepEqual(github.bodies, [{ ref: 'main', inputs: { mode: 'run', run_ids: runId, user_id: '' } }]);
  let [run] = db.readRuns();
  assert.equal(run.status, 'queued');
  assert.equal(run.dispatchedAt, NOW.toISOString());
  assert.equal(groupEvents(db.readEvents(runId)).stage, 'waiting');

  // A second press on the same ticker while it runs is refused, not paid for twice.
  const again = await queueRuns({ db: db.queueDb, dispatch: async () => ({ ok: true }), configured: true }, input);
  assert.equal(again.ok, false);
  assert.equal(db.runs.length, 1);

  // 2. The worker claims it; a second worker (a retried workflow) can't.
  const worker = db.worker(runId);
  assert.equal(worker.claim(), true);
  assert.equal(db.worker(runId).claim(), false);
  worker.emit('desk', 'status', 'Analysts started.');
  worker.emit('news', 'report', 'Quiet week for the stock.');
  worker.emit('market', 'report', 'Above its 50-day average.');
  worker.emit('bull', 'turn', 'Retail margins are recovering.');

  // Mid-run, the live view polls and shows how far it has got.
  const firstPoll = db.readEvents(runId);
  assert.equal(groupEvents(firstPoll).stage, 'debate');
  assert.equal(STAGE_LABELS[groupEvents(firstPoll).stage], 'Bull and Bear are debating');
  [run] = db.readRuns();
  assert.equal(effectiveStatus(run, new Date(NOW.getTime() + 5 * 60_000)), 'running');

  worker.emit('bear', 'turn', 'Valuation is already rich.');
  worker.emit('research_manager', 'report', 'Lean long, small.');
  worker.emit('trader', 'report', TRADER);
  worker.emit('risk_aggressive', 'turn', 'Size up.');
  worker.emit('risk_conservative', 'turn', 'Keep it small.');
  worker.emit('risk_neutral', 'turn', 'Half size.');
  worker.emit('portfolio_manager', 'decision', FINAL);
  assert.equal(worker.cancelled(), false);
  // What research_desk/decision.py's parse_decision makes of FINAL and TRADER.
  assert.equal(worker.finish({
    rating: 'Overweight', summary: 'Add on dips; margins are recovering.', thesis: null, priceTarget: 3200, horizon: null,
    entry: 2880, stop: 2700, sizing: null, trader: 'Buy',
  }, { input_tokens: 180_000, output_tokens: 22_000, cost_usd: 0.4123 }), true);

  // 3. The next poll asks only for what it hasn't got, and the two halves make the whole run once.
  const lastSeq = firstPoll.at(-1)?.seq ?? 0;
  const secondPoll = db.readEvents(runId, lastSeq);
  assert.equal(secondPoll[0].seq, lastSeq + 1);
  const timeline = groupEvents([...firstPoll, ...secondPoll, ...secondPoll]);
  assert.equal(timeline.stage, 'decided');
  assert.deepEqual(timeline.status.map((said) => said.content), ['Analysts started.']);
  assert.deepEqual(timeline.reports.map((said) => said.agent), ['market', 'news']);
  assert.deepEqual(timeline.debate.map((said) => said.agent), ['bull', 'bear']);
  assert.equal(timeline.plan, 'Lean long, small.');
  assert.equal(timeline.trader, TRADER);
  assert.equal(timeline.risk.length, 3);
  assert.equal(timeline.decision, FINAL);

  // 4. The card: the call, its levels, the cost, and the position it is weighed against.
  [run] = db.readRuns();
  assert.equal(effectiveStatus(run, new Date(NOW.getTime() + 10 * 60_000)), 'done');
  assert.equal(run.decision?.rating, 'Overweight');
  assert.equal(run.decision?.priceTarget, 3200);
  assert.equal(run.decision?.trader, 'Buy');
  assert.equal(run.costUsd, 0.4123);
  assert.equal(run.tokens, 202_000);
  assert.equal(positionLine(run.portfolio, run.ticker), 'You hold 20 at an average of ₹2,600.');
  assert.equal(trackRecord(db.readSettlements()).count, 0);
  assert.match(trackRecord(db.readSettlements()).line, /No calls settled yet/);

  // 5. A week later the settle job scores it against Nifty (the row research_desk/memory.py writes).
  db.settlements.push({
    user_id: USER, run_id: runId, ticker: run.ticker, trade_date: run.tradeDate, benchmark: '^NSEI', holding_days: 5,
    return_pct: '2.400', benchmark_pct: '0.900', alpha_pct: '1.500', reflection: 'The margin call was right.', settled_at: '2026-11-03T12:00:00Z',
  });
  const settled = db.readSettlements();
  assert.equal(settled.length, 1);
  assert.equal(settled[0].runId, run.id);
  assert.equal(settled[0].alphaPct, 1.5);
  assert.deepEqual(trackRecord(settled), { count: 1, beat: 1, averageAlpha: 1.5, line: 'Last call: beat Nifty, alpha +1.5%.' });
});

test('a run stopped mid-way stays stopped: the worker sees it and can never mark it done', async () => {
  const db = fakeDatabase();
  const github = fakeGitHub();
  const queued = await queueRuns({ db: db.queueDb, dispatch: (dispatch) => dispatchRuns(dispatch, { config: CONFIG, fetch: github.fetchImpl }), configured: true }, input);
  const runId = queued.ok ? queued.runIds[0] : '';
  const worker = db.worker(runId);
  assert.equal(worker.claim(), true);
  worker.emit('market', 'report', 'Above its 50-day average.');

  assert.deepEqual(await cancelRun({ db: db.queueDb }, { userId: USER, runId }), { ok: true });
  assert.equal(worker.cancelled(), true);
  assert.equal(worker.finish({ rating: 'Buy' }, { input_tokens: 1, output_tokens: 1, cost_usd: 0.01 }), false);

  const [run] = db.readRuns();
  assert.equal(run.status, 'cancelled');
  assert.equal(run.decision, null);
  // What was written before the stop is still shown.
  assert.equal(groupEvents(db.readEvents(runId)).stage, 'analysts');
  // And the ticker is free for a new press.
  const next = await queueRuns({ db: db.queueDb, dispatch: async () => ({ ok: true }), configured: true }, input);
  assert.equal(next.ok, true);
});

test('a run GitHub refused reads as failed with its reason, and a run no worker claimed fails after 45 minutes', async () => {
  const refused = fakeDatabase();
  const github = fakeGitHub(401);
  const result = await queueRuns({ db: refused.queueDb, dispatch: (dispatch) => dispatchRuns(dispatch, { config: CONFIG, fetch: github.fetchImpl }), configured: true }, input);
  assert.equal(result.ok, false);
  const [failed] = refused.readRuns();
  assert.equal(failed.status, 'failed');
  assert.match(failed.error ?? '', /GitHub refused the request/);
  // The worker, if it ever started, couldn't claim it.
  assert.equal(refused.worker(failed.id).claim(), false);

  const lost = fakeDatabase();
  await queueRuns({ db: lost.queueDb, dispatch: async () => ({ ok: true }), configured: true }, input);
  const [waiting] = lost.readRuns();
  assert.equal(effectiveStatus(waiting, new Date(NOW.getTime() + 44 * 60_000)), 'queued');
  assert.equal(effectiveStatus(waiting, new Date(NOW.getTime() + 46 * 60_000)), 'failed');
});
