import { test } from 'vitest';
import assert from 'node:assert/strict';
import { groupEvents, plainText, positionLine } from './timeline';
import { trackRecord } from './track';
import type { ResearchEvent, ResearchSettlement } from './types';

let seq = 0;
const event = (agent: ResearchEvent['agent'], kind: ResearchEvent['kind'], content: string): ResearchEvent => ({ seq: ++seq, agent, kind, content, at: '2026-10-27T04:00:00Z' });

test('events become the run as a story: reports, the debate, the plan, the trade, the risk talk, the call', () => {
  const grouped = groupEvents([
    event('desk', 'status', 'Analysts started.'),
    event('news', 'report', 'Quiet week.'),
    event('market', 'report', 'Uptrend.'),
    event('bull', 'turn', 'Margins expand.'),
    event('bear', 'turn', 'Valuation is rich.'),
    event('research_manager', 'report', 'Lean long.'),
    event('trader', 'report', '**Action**: Buy'),
    event('risk_aggressive', 'turn', 'Size up.'),
    event('risk_conservative', 'turn', 'Keep it small.'),
    event('risk_neutral', 'turn', 'Half size.'),
    event('portfolio_manager', 'decision', '**Rating**: Overweight'),
  ]);
  assert.deepEqual(grouped.status.map((item) => item.content), ['Analysts started.']);
  // Reports keep a fixed order, whatever order they finished in.
  assert.deepEqual(grouped.reports.map((item) => item.agent), ['market', 'news']);
  assert.deepEqual(grouped.debate.map((item) => item.agent), ['bull', 'bear']);
  assert.equal(grouped.plan, 'Lean long.');
  assert.equal(grouped.trader, '**Action**: Buy');
  assert.deepEqual(grouped.risk.map((item) => item.agent), ['risk_aggressive', 'risk_conservative', 'risk_neutral']);
  assert.equal(grouped.decision, '**Rating**: Overweight');
  assert.equal(grouped.stage, 'decided');
});

test('the stage says how far a run has got', () => {
  assert.equal(groupEvents([]).stage, 'waiting');
  assert.equal(groupEvents([event('market', 'report', 'x')]).stage, 'analysts');
  assert.equal(groupEvents([event('market', 'report', 'x'), event('bull', 'turn', 'y')]).stage, 'debate');
  assert.equal(groupEvents([event('trader', 'report', 'x')]).stage, 'trader');
  assert.equal(groupEvents([event('risk_neutral', 'turn', 'x')]).stage, 'risk');
});

test('a repeated event (a poll that overlapped) is shown once', () => {
  const one = event('bull', 'turn', 'Same.');
  assert.equal(groupEvents([one, one]).debate.length, 1);
});

test('markdown reads as plain text', () => {
  assert.equal(plainText('## Summary\n\n**Rating**: Buy\n\n\n\n`code` and __bold__'), 'Summary\n\nRating: Buy\n\ncode and bold');
});

test('what a call means for the position held', () => {
  const portfolio = { currency: 'INR' as const, cash: null, positions: [{ ticker: 'RELIANCE.NS', quantity: 20, average_price: 2600 }] };
  assert.equal(positionLine(portfolio, 'RELIANCE.NS'), 'You hold 20 at an average of ₹2,600.');
  assert.equal(positionLine(portfolio, 'TCS.NS'), 'You don’t hold this now.');
  assert.equal(positionLine(null, 'TCS.NS'), null);
});

const settled = (alphaPct: number, ticker = 'RELIANCE.NS', tradeDate = '2026-10-01'): ResearchSettlement => ({
  runId: `${ticker}-${tradeDate}-${alphaPct}`, ticker, tradeDate, benchmark: ticker.endsWith('.BO') ? '^BSESN' : '^NSEI', holdingDays: 5,
  returnPct: alphaPct + 1, benchmarkPct: 1, alphaPct, reflection: null, settledAt: '2026-10-09T00:00:00Z',
});

test('the track record counts the last 12 calls against their benchmark', () => {
  assert.deepEqual(trackRecord([]), { count: 0, beat: 0, averageAlpha: null, line: 'No calls settled yet. Each call is scored against Nifty five trading days after its date.' });
  const record = trackRecord([settled(2), settled(-1), settled(1.2)]);
  assert.equal(record.count, 3);
  assert.equal(record.beat, 2);
  assert.equal(record.averageAlpha, 0.7);
  assert.equal(record.line, 'Last 3 calls: 2 beat Nifty, average alpha +0.7%.');
  const many = trackRecord(Array.from({ length: 20 }, (_, index) => settled(index % 2 ? 1 : -1, 'TCS.NS', `2026-09-${String(index + 1).padStart(2, '0')}`)));
  assert.equal(many.count, 12);
  assert.equal(trackRecord([settled(-2.04)]).line, 'Last call: did not beat Nifty, alpha −2.0%.');
  assert.match(trackRecord([settled(1, '500325.BO'), settled(1)]).line, /beat the index/);
});
