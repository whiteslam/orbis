import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readDecision, questionDepthRequest } from './decide';

test('the Jev request carries only the question, and always asks for zero data retention', () => {
  const body = questionDepthRequest('typesafe/jev-1.13', 'How did my spending change in stressful weeks?');
  assert.equal(body.model, 'typesafe/jev-1.13');
  assert.deepEqual(body.state, { question: 'How did my spending change in stressful weeks?' });
  assert.deepEqual(Object.keys(body.questions.depth.criteria).sort(), ['lookup', 'reasoning']);
  assert.equal(body.questions.depth.type, 'choice');
  assert.deepEqual(body.provider, { zdr: true, data_collection: 'deny' });
});
test('the question is cut to a short, bounded length', () => {
  assert.equal(questionDepthRequest('m', 'x'.repeat(5_000)).state.question.length, 600);
});

// Jev's "confidence" summarises the whole distribution and can be low while the
// chosen option is clearly ahead (live: lookup 0.74 with confidence 0.47), so
// the verdict rests on the chosen option's own probability.
const reply = (choice: string, probability: number, cost = 0.000015) => ({
  model: 'typesafe/jev-1.13-20260917',
  answers: { depth: { type: 'choice', choice, confidence: 0.47, probabilities: { [choice]: probability } } },
  usage: { input_tokens: 366, output_tokens: 35, cost },
});

test('a confident choice is the verdict, with the cost and tokens OpenRouter reported', () => {
  assert.deepEqual(readDecision(reply('reasoning', 0.9), 'depth', ['lookup', 'reasoning']), {
    choice: 'reasoning', probability: 0.9, usage: { inputTokens: 366, outputTokens: 35 }, costUsd: 0.000015,
  });
});
test('an unsure, unknown or malformed answer is no verdict, so the mode decides', () => {
  assert.equal(readDecision(reply('reasoning', 0.4), 'depth', ['lookup', 'reasoning'])?.choice ?? null, null);
  assert.equal(readDecision(reply('poetry', 0.99), 'depth', ['lookup', 'reasoning'])?.choice ?? null, null);
  assert.equal(readDecision({ error: { code: 404 } }, 'depth', ['lookup', 'reasoning'])?.choice ?? null, null);
  assert.equal(readDecision(null, 'depth', ['lookup', 'reasoning'])?.choice ?? null, null);
});
test('usage is still reported for an unsure answer, so its cost is logged', () => {
  assert.equal(readDecision(reply('reasoning', 0.4), 'depth', ['lookup', 'reasoning'])?.costUsd, 0.000015);
});

test('a clear favourite counts even when Jev’s overall confidence is low', () => {
  assert.equal(readDecision(reply('lookup', 0.74), 'depth', ['lookup', 'reasoning'])?.choice, 'lookup');
});
