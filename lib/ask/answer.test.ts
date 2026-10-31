import { beforeEach, test, vi } from 'vitest';
import assert from 'node:assert/strict';

// The paid calls (Sarvam, Jev, the model) and the credit claim are counted;
// everything else is stubbed to let a request through.
const calls = vi.hoisted(() => ({ order: [] as string[], allowed: true, used: ['journal'] as string[], reply: null as string | null }));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/ai/gate', () => ({ aiBlocked: async () => null }));
vi.mock('@/lib/ask/context', () => ({
  buildAskContext: async () => ({ used: calls.used, data: { journal: [] }, citations: [] }),
}));
vi.mock('@/lib/ai/jev', () => ({
  needsReasoning: async () => {
    calls.order.push('jev');
    return false;
  },
}));
vi.mock('@/lib/ai/router', () => ({
  routeJson: async () => {
    calls.order.push('model');
    return { text: calls.reply ?? JSON.stringify({ answer: 'You spent less.', citations: [] }) };
  },
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    rpc: async () => {
      calls.order.push('claim');
      return { data: calls.allowed, error: null };
    },
  }),
}));
vi.mock('@/lib/auth/session', () => ({ requireUser: async () => ({ userId: 'user-1' }) }));
vi.mock('@/lib/voice/sarvam', () => ({
  transcribe: async () => {
    calls.order.push('transcribe');
    return { transcript: 'how much did I spend', language: 'en-IN' };
  },
  speak: async () => {
    calls.order.push('speak');
    return null;
  },
}));

const { answerFromRecords, DAILY_ASK_LIMIT } = await import('./answer.ts');
const { talkToOrbisAction } = await import('../../app/ask/talk-actions.ts');

const SPENT = `You have asked ${DAILY_ASK_LIMIT} questions today. Try again tomorrow.`;

function spoken() {
  const form = new FormData();
  form.set('audio', new Blob([new Uint8Array(1024)], { type: 'audio/webm' }));
  return form;
}

beforeEach(() => {
  calls.order = [];
  calls.allowed = true;
  calls.used = ['journal'];
  calls.reply = null;
  process.env.SARVAM_API_KEY = 'test-key';
});

test('a typed question claims its credit before Jev or the model runs', async () => {
  const result = await answerFromRecords({ userId: 'user-1', question: 'how much did I spend', sources: ['journal'] });
  assert.equal(result.success, true);
  assert.deepEqual(calls.order, ['claim', 'jev', 'model']);
});

test('with the allowance used up, a typed question pays for nothing', async () => {
  calls.allowed = false;
  const result = await answerFromRecords({ userId: 'user-1', question: 'how much did I spend', sources: ['journal'] });
  assert.deepEqual(result, { success: false, message: SPENT });
  assert.deepEqual(calls.order, ['claim']);
});

test('an empty request is turned away before a credit or Jev is spent', async () => {
  calls.used = [];
  const result = await answerFromRecords({ userId: 'user-1', question: 'how much did I spend', sources: ['journal'] });
  assert.equal(result.success, false);
  assert.deepEqual(calls.order, []);
});

test('a spoken question claims one credit, before it is transcribed', async () => {
  const result = await talkToOrbisAction(spoken());
  assert.equal(result.success, true);
  assert.deepEqual(calls.order, ['claim', 'transcribe', 'jev', 'model', 'speak']);
});

test('with the allowance used up, a spoken question is never transcribed', async () => {
  calls.allowed = false;
  const result = await talkToOrbisAction(spoken());
  assert.deepEqual(result, { success: false, message: SPENT });
  assert.deepEqual(calls.order, ['claim']);
});

test('an answer carries what was inferred and the follow-ups, cleaned and capped', async () => {
  calls.reply = JSON.stringify({
    answer: 'You spent ₹6,240 on eating out.',
    citations: [],
    inferred: ['Weekends seem to drive it.', '  ', 42, 'Weekends seem to drive it.', 'A third one is dropped.'],
    followUps: ['Which weekend cost the most?', 'Is ₹6,240 above my usual month?', 'What counts as eating out?', 'A fourth is dropped?'],
  });
  const result = await answerFromRecords({ userId: 'user-1', question: 'how much did I eat out', sources: ['journal'] });
  assert.deepEqual(result.inferred, ['Weekends seem to drive it.', 'A third one is dropped.']);
  assert.deepEqual(result.followUps, ['Which weekend cost the most?', 'Is ₹6,240 above my usual month?', 'What counts as eating out?']);
});

test('a reply without the new fields still answers, with empty lists', async () => {
  const result = await answerFromRecords({ userId: 'user-1', question: 'how much did I spend', sources: ['journal'] });
  assert.equal(result.answer, 'You spent less.');
  assert.deepEqual(result.inferred, []);
  assert.deepEqual(result.followUps, []);
});
