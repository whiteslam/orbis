import { test } from 'node:test';
import assert from 'node:assert/strict';
import { briefSnapshot, snapshotFingerprint } from './ai-brief.ts';
import { parseBrief } from '../brief/style.ts';

const parseBriefCaption = (text: string) => parseBrief(text, 'note')?.caption ?? null;
import type { FinanceSummary } from '../finance/types.ts';
import type { StepsSummary } from '../health/types.ts';

const NOW = new Date('2026-09-25T09:00:00Z');

const finance = (over: Partial<FinanceSummary> = {}): FinanceSummary => ({
  databaseReady: true, loadError: false, connection: null,
  pendingCandidateCount: 0, unparsedCandidateCount: 0, reviewCandidates: [],
  transactions: [], monthlyExpenses: [], ...over,
} as FinanceSummary);

const steps = (over: Partial<StepsSummary> = {}): StepsSummary => ({ latest: null, average7: null, average30: null, days: [], ...over } as StepsSummary);

const base = { finance: finance(), steps: steps(), documentCount: 0, name: null, now: NOW };

test('the fingerprint moves when the data does, or when the day turns a corner', () => {
  const quiet = snapshotFingerprint(briefSnapshot(base));
  // Same stretch of the day, same numbers: the caption is still true, and the
  // clock ticking must not spend a generation.
  const minutesLater = snapshotFingerprint(briefSnapshot({ ...base, now: new Date('2026-09-25T09:40:00Z') }));
  assert.equal(quiet, minutesLater, 'the clock alone never forces a rewrite');

  // A caption written for the morning is wrong by the evening, so this moves.
  const evening = snapshotFingerprint(briefSnapshot({ ...base, now: new Date('2026-09-25T15:00:00Z') }));
  assert.notEqual(quiet, evening, 'the wording is written for a stretch of the day');

  const withAlert = snapshotFingerprint(briefSnapshot({ ...base, finance: finance({ pendingCandidateCount: 2 }) }));
  assert.notEqual(quiet, withAlert, 'confirming alerts must force a rewrite');

  const tomorrow = snapshotFingerprint(briefSnapshot({ ...base, now: new Date('2026-09-26T09:00:00Z') }));
  assert.notEqual(quiet, tomorrow, 'a brief never outlives its day');
});

test('the snapshot sends formatted figures, never raw amounts to add up', () => {
  const snapshot = briefSnapshot({
    ...base,
    finance: finance({ monthlyExpenses: [{ currency: 'INR', amount: 24_000 }] }),
  });
  assert.equal(snapshot.finance.spentThisMonth, '₹24,000');
  assert.equal(snapshot.finance.perDay, '₹960');
  // Nothing in the payload is a bare transaction the model could re-total.
  assert.ok(!JSON.stringify(snapshot).includes('occurredAt'));
});

const caption = (text: string) => JSON.stringify({ caption: text });
const LONG = 'You have two alerts waiting on a yes or no, and spending is at twenty four thousand so far this month. The gym asks for upper body today.';

test('a reply that is a list or a heading is not a caption', () => {
  assert.equal(parseBriefCaption(caption(`- ${LONG}`)), null);
  assert.equal(parseBriefCaption(caption(`# ${LONG}`)), null);
  assert.equal(parseBriefCaption(JSON.stringify({ caption: `${LONG}\n- and a bullet` })), null);
});

test('em dashes are rewritten rather than trusted to the prompt', () => {
  const parsed = parseBriefCaption(caption(`Rain is likely around 9 pm — 80% — so move things earlier. ${LONG}`));
  assert.ok(parsed);
  assert.ok(!/[—–]/.test(parsed), `em dash survived: ${parsed}`);
  assert.match(parsed, /around 9 pm, 80%, so move things earlier/);
  // The substitution must not leave doubled commas or space before punctuation.
  assert.ok(!/,\s*,/.test(parsed));
  assert.ok(!/\s[,.;:]/.test(parsed));
});

test('whitespace is collapsed and the caption is capped', () => {
  const parsed = parseBriefCaption(caption(`  spaced \n  out.  ${LONG}`));
  assert.match(parsed ?? '', /^spaced out\./);
  assert.equal((parseBriefCaption(caption('x'.repeat(900))) ?? '').length, 260, 'the caption is two sentences, so it is capped tight');
});

test('a caption too short to be worth reading is refused', () => {
  assert.equal(parseBriefCaption(caption('All quiet.')), null);
});

test('an unusable reply returns null so Orbis’s own wording stays', () => {
  assert.equal(parseBriefCaption('not json'), null);
  assert.equal(parseBriefCaption(JSON.stringify({ caption: '' })), null);
  assert.equal(parseBriefCaption(JSON.stringify({ paragraphs: [LONG] })), null, 'the old shape is not accepted');
  assert.equal(parseBriefCaption(JSON.stringify({ caption: 42 })), null);
});
