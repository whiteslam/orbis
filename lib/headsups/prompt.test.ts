import { test } from 'vitest';
import assert from 'node:assert/strict';
import { clampWording, parseWording, wordingPrompt } from './prompt.ts';
import type { Finding } from './types.ts';

const finding: Finding = {
  kind: 'money.category_hot',
  dedupeKey: 'money.category_hot:Food:2026-09',
  urgency: 'normal',
  evidence: { category: 'Food', thisMonth: 4000, usual: 3000, day: 20, currency: 'INR' },
  action: { type: 'review_category', category: 'Food' },
  fallback: { title: 'Food is running ahead this month', body: '₹4,000 so far.', actionLabel: 'See Food' },
};

test('the prompt carries the kind, the evidence and the fallback, and nothing else', () => {
  const { user } = wordingPrompt(finding);
  const sent = JSON.parse(user);
  assert.deepEqual(Object.keys(sent).sort(), ['evidence', 'fallback', 'kind']);
  assert.deepEqual(sent.evidence, finding.evidence);
  assert.equal(user.includes('dedupe'), false);
});

test('valid output is accepted and trimmed', () => {
  assert.deepEqual(parseWording('{"title":" Food is ahead ","body":"₹4,000 vs ₹3,000.","actionLabel":"See Food"}'), { title: 'Food is ahead', body: '₹4,000 vs ₹3,000.', actionLabel: 'See Food' });
});

test('junk falls back', () => {
  assert.equal(parseWording('Sure! Here is your heads-up.'), null);
  assert.equal(parseWording('{"title":"Hi","body":"x"}'), null, 'missing actionLabel');
  assert.equal(parseWording(JSON.stringify({ title: 'x'.repeat(81), body: 'b', actionLabel: 'a' })), null, 'title too long');
  assert.equal(parseWording(JSON.stringify({ title: 't', body: 'b'.repeat(301), actionLabel: 'a' })), null, 'body too long');
  assert.equal(parseWording(JSON.stringify({ title: 't', body: 'b', actionLabel: 'a'.repeat(41) })), null, 'label too long');
  assert.equal(parseWording(JSON.stringify({ title: '  ', body: 'b', actionLabel: 'a' })), null, 'blank title');
});

test('wording that is too long is cut to the limits, with an ellipsis', () => {
  const clamped = clampWording({ title: 't'.repeat(90), body: 'b'.repeat(310), actionLabel: 'a'.repeat(45) });
  assert.equal(clamped.title.length, 80);
  assert.equal(clamped.body.length, 300);
  assert.equal(clamped.actionLabel.length, 40);
  assert.ok(clamped.title.endsWith('…'));
  assert.deepEqual(clampWording({ title: 'ok', body: 'fine', actionLabel: 'go' }), { title: 'ok', body: 'fine', actionLabel: 'go' });
});
