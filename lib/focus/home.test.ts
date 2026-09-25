import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeFocus, composeQuietRows, type FocusInput } from './home.ts';
import type { FinanceSummary } from '../finance/types.ts';
import type { GoalsSummary } from '../goals/types.ts';
import type { StepsSummary } from '../health/types.ts';

const finance = (overrides: Partial<FinanceSummary> = {}): FinanceSummary => ({
  databaseReady: true,
  loadError: false,
  connection: { email: 'you@example.com', status: 'connected', lastSyncAt: null },
  pendingCandidateCount: 0,
  unparsedCandidateCount: 0,
  reviewCandidates: [],
  transactions: [],
  monthlyExpenses: [],
  month: null,
  ...overrides,
});

const goals = (overrides: Partial<GoalsSummary> = {}): GoalsSummary => ({ databaseReady: true, goals: [], habits: [], ...overrides });

const steps = (overrides: Partial<StepsSummary> = {}): StepsSummary => ({
  databaseReady: true,
  loadError: false,
  days: [],
  latest: null,
  average7: null,
  average30: null,
  previous30: null,
  best: null,
  lastImport: null,
  ...overrides,
});

// A fully set-up account with nothing outstanding, so each test can break one thing.
const settled = (overrides: Partial<FocusInput> = {}): FocusInput => ({
  finance: finance(),
  goals: goals({ goals: [{ id: '1', title: 'Read 12 books', current: 3, target: 12, unit: 'books', dueDate: null }] }),
  steps: steps({ average7: 8_000, average30: 8_000, previous30: 8_000 }),
  documentCount: 2,
  now: new Date('2026-09-24T14:30:00Z'),
  ...overrides,
});

const first = (input: FocusInput) => composeFocus(input)[0];
const ids = (input: FocusInput) => composeFocus(input).map((slide) => slide.id);

test('a broken finance load leads the brief', () => {
  assert.equal(first(settled({ finance: finance({ loadError: true, pendingCandidateCount: 4, connection: null }) })).id, 'finance-unavailable');
});

test('an expired Gmail connection is shown before the alerts it blocks', () => {
  const order = ids(settled({
    finance: finance({ connection: { email: 'you@example.com', status: 'reconnect_required', lastSyncAt: null }, pendingCandidateCount: 6 }),
  }));
  assert.deepEqual(order.slice(0, 2), ['gmail-reconnect', 'review-alerts']);
  assert.match(composeFocus(settled({ finance: finance({ connection: { email: 'you@example.com', status: 'reconnect_required', lastSyncAt: null } }) }))[0].body, /you@example\.com/);
});

test('alerts waiting for review are counted and given an honest time cost', () => {
  const one = first(settled({ finance: finance({ pendingCandidateCount: 1 }) }));
  assert.equal(one.id, 'review-alerts');
  assert.match(one.headline, /^One alert/);
  assert.match(one.body, /a minute, tops/);

  const many = first(settled({ finance: finance({ pendingCandidateCount: 9 }) }));
  assert.match(many.headline, /^9 alerts/);
  assert.match(many.body, /about 3 minutes/);
});

test('connecting Gmail is offered only once the database is ready', () => {
  assert.ok(ids(settled({ finance: finance({ connection: null }) })).includes('connect-gmail'));
  assert.ok(!ids(settled({ finance: finance({ connection: null, databaseReady: false }) })).includes('connect-gmail'));
});

test('a goal past its date is reported before one that is merely close', () => {
  const overdue = { id: '1', title: 'Run 100 km', current: 60, target: 100, unit: 'km', dueDate: '2026-09-01' };
  const soon = { id: '2', title: 'Save ₹50,000', current: 20_000, target: 50_000, unit: '₹', dueDate: '2026-10-02' };
  const slide = first(settled({ goals: goals({ goals: [soon, overdue] }) }));
  assert.equal(slide.id, 'goal-overdue');
  assert.match(slide.headline, /Run 100 km/);
});

test('a goal due inside two weeks leads, further out does not', () => {
  const near = first(settled({ goals: goals({ goals: [{ id: '1', title: 'Save ₹50,000', current: 25_000, target: 50_000, unit: '₹', dueDate: '2026-10-02' }] }) }));
  assert.equal(near.id, 'goal-due-soon');
  assert.match(near.headline, /8 days left/);

  assert.ok(!ids(settled({ goals: goals({ goals: [{ id: '1', title: 'Save ₹50,000', current: 25_000, target: 50_000, unit: '₹', dueDate: '2027-03-01' }] }) })).includes('goal-due-soon'));
});

test('a falling step average is surfaced with both numbers', () => {
  const slide = composeFocus(settled({ steps: steps({ average7: 6_000, average30: 6_400, previous30: 8_000 }) })).find((item) => item.id === 'steps-falling');
  assert.ok(slide, 'expected a step slide');
  assert.match(slide.headline, /down 20%/);
  assert.match(slide.body, /6,400 a day over the last 30 days/);
  assert.match(slide.body, /8,000/);
  assert.match(slide.source ?? '', /30-day averages/);
});

test('setup nudges come last, never ahead of what is already true', () => {
  const withInsight = ids(settled({ documentCount: 0 }));
  assert.ok(withInsight.includes('upload-workbook'));
  assert.equal(withInsight[withInsight.length - 1], 'upload-workbook', 'the nudge sits after the reading');
  assert.ok(withInsight.indexOf('goal-moving') < withInsight.indexOf('upload-workbook'));

  // With nothing else to say, a nudge is still better than an empty brief.
  const bare = ids(settled({ goals: goals({ goals: [] }), documentCount: 2 }));
  assert.deepEqual(bare, ['set-goal']);
});

test('the brief runs attention, then readings, then setup', () => {
  const order = ids(settled({
    finance: finance({ connection: null, pendingCandidateCount: 2, monthlyExpenses: [{ currency: 'INR', amount: 24_000 }] }),
    steps: steps({ average7: 6_000, average30: 6_400, previous30: 8_000 }),
  }));
  assert.equal(order[0], 'review-alerts', 'waiting work leads');
  assert.ok(order.indexOf('spending-pace') > order.indexOf('review-alerts'));
  assert.ok(order.indexOf('steps-falling') > order.indexOf('spending-pace'));
  // connect-gmail is a setup task, so it sinks below every reading.
  const gmail = ids(settled({ finance: finance({ connection: null, monthlyExpenses: [{ currency: 'INR', amount: 24_000 }] }) }));
  assert.ok(gmail.indexOf('connect-gmail') > gmail.indexOf('spending-pace'));
});

test('the brief is capped so it stays a brief', () => {
  const slides = composeFocus(settled({
    finance: finance({ connection: null, pendingCandidateCount: 3, monthlyExpenses: [{ currency: 'INR', amount: 24_000 }] }),
    goals: goals({ goals: [{ id: '1', title: 'Save ₹50,000', current: 25_000, target: 50_000, unit: '₹', dueDate: '2026-10-02' }] }),
    steps: steps({ average7: 6_000, average30: 6_400, previous30: 8_000 }),
    documentCount: 0,
    savedAdviceAt: '2026-09-22T09:12:00Z',
  }));
  assert.equal(slides.length, 4);
  assert.equal(new Set(slides.map((slide) => slide.id)).size, 4, 'slides are distinct');
});

test('spending is projected forward rather than just restated', () => {
  const slide = composeFocus(settled({ finance: finance({ monthlyExpenses: [{ currency: 'INR', amount: 24_000 }] }) })).find((item) => item.id === 'spending-pace');
  assert.ok(slide, 'expected a spending slide');
  assert.match(slide.body, /₹1,000 a day/);
  assert.match(slide.body, /lands near ₹30,000/);
});

test('weather only earns a slide when it changes what you would do', () => {
  const mild = ids(settled({ weather: { temperature: 26, rainProbability: 10, condition: 'Partly cloudy', weatherCode: 2 } }));
  assert.ok(!mild.includes('weather-note'));

  const wet = composeFocus(settled({ weather: { temperature: 24, rainProbability: 100, condition: 'Rain showers', weatherCode: 61 } }))
    .find((slide) => slide.id === 'weather-note');
  assert.ok(wet, 'expected a weather slide');
  assert.match(wet.headline, /100% chance/);
});

test('a quiet account gets one slide that admits it', () => {
  // A goal that has not moved yet says nothing useful, so nothing else qualifies either.
  const slides = composeFocus(settled({ goals: goals({ goals: [{ id: '1', title: 'Read 12 books', current: 0, target: 12, unit: 'books', dueDate: null }] }) }));
  assert.equal(slides.length, 1);
  assert.equal(slides[0].id, 'calm');
  assert.match(slides[0].headline, /evening/i);
});

test('quiet rows mark absent data as empty rather than zero', () => {
  const rows = composeQuietRows({ finance: finance(), goals: goals(), steps: steps(), documentCount: 0 });
  const spending = rows.find((row) => row.label === 'Spending this month');
  assert.equal(spending?.value, 'No data');
  assert.equal(spending?.empty, true);
  assert.equal(rows.find((row) => row.label === 'Health documents')?.value, 'None yet');

  const filled = composeQuietRows({
    finance: finance({ monthlyExpenses: [{ currency: 'INR', amount: 24_000 }], pendingCandidateCount: 2 }),
    goals: goals({ goals: [{ id: '1', title: 'x', current: 0, target: 1, unit: '', dueDate: null }] }),
    steps: steps({ average7: 8_240 }),
    documentCount: 1,
  });
  assert.equal(filled.find((row) => row.label === 'Alerts to confirm')?.empty, false);
  assert.equal(filled.find((row) => row.label === 'Steps, 7-day average')?.value, '8,240 a day');
  assert.equal(filled.find((row) => row.label === 'Health documents')?.value, '1 file');
});
