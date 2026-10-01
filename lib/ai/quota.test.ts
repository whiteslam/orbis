import { test } from 'vitest';
import assert from 'node:assert/strict';
import { claimAiCredit, type Rpc } from './quota';

type Call = { fn: string; args: Record<string, unknown> };

function fakeRpc(answer: (call: Call) => { data: unknown; error: { code?: string } | null }) {
  const calls: Call[] = [];
  const rpc: Rpc = async (fn, args) => {
    calls.push({ fn, args });
    return answer({ fn, args });
  };
  return { rpc, calls };
}

test('each feature claims its own counter, so the brief cannot spend advice credits', async () => {
  const { rpc, calls } = fakeRpc(() => ({ data: true, error: null }));
  assert.equal(await claimAiCredit(rpc, 'user-1', 'home_brief', 12), 'ok');
  assert.equal(await claimAiCredit(rpc, 'user-1', 'workbook_advice', 5), 'ok');
  assert.deepEqual(calls.map((call) => [call.fn, call.args.p_feature, call.args.p_daily_limit]), [
    ['consume_ai_feature_request', 'home_brief', 12],
    ['consume_ai_feature_request', 'workbook_advice', 5],
  ]);
});
test('a refused claim means the day’s limit is reached', async () => {
  const { rpc } = fakeRpc(() => ({ data: false, error: null }));
  assert.equal(await claimAiCredit(rpc, 'user-1', 'portfolio_advice', 5), 'limit');
});
test('before the migration is applied, the old shared counter is used rather than failing', async () => {
  const { rpc, calls } = fakeRpc((call) => call.fn === 'consume_ai_feature_request'
    ? { data: null, error: { code: 'PGRST202' } }
    : { data: true, error: null });
  assert.equal(await claimAiCredit(rpc, 'user-1', 'health_plan', 10), 'ok');
  assert.deepEqual(calls[1], { fn: 'consume_workbook_ai_request', args: { p_user_id: 'user-1', p_daily_limit: 10 } });
});
test('any other database error is an error, not a free request', async () => {
  const { rpc } = fakeRpc(() => ({ data: null, error: { code: '57014' } }));
  assert.equal(await claimAiCredit(rpc, 'user-1', 'home_brief', 12), 'error');
});
test('a thrown call is an error', async () => {
  const rpc: Rpc = async () => { throw new Error('network'); };
  assert.equal(await claimAiCredit(rpc, 'user-1', 'home_brief', 12), 'error');
});
