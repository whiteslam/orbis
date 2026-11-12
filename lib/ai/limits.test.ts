import { readFileSync } from 'node:fs';
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { dailyLimit, FALLBACK_LIMITS, limitFor, RPC_CAPS } from './limits.ts';

test('with no plan, a feature gets its fallback', () => {
  assert.equal(limitFor('home_brief', null), FALLBACK_LIMITS.home_brief);
  assert.equal(limitFor('home_brief', {}), FALLBACK_LIMITS.home_brief);
});

test('a positive whole number in the plan wins', () => {
  assert.equal(limitFor('home_brief', { home_brief: 40 }), 40);
});

test('a negative, zero, fractional or non-numeric value falls back', () => {
  for (const bad of [-1, 0, 2.5, Number.NaN, '40' as unknown as number]) {
    assert.equal(limitFor('home_brief', { home_brief: bad }), FALLBACK_LIMITS.home_brief, String(bad));
  }
});

test('today\'s limits are unchanged', () => {
  assert.deepEqual({ ...FALLBACK_LIMITS }, {
    ask_orbis: 20, home_brief: 8, portfolio_news: 4, workbook_advice: 5, health_plan: 10, portfolio_advice: 5,
    career_profile: 30, career_spec: 40, career_requirements: 800, career_tailor: 80, career_alerts: 300,
    career_mail: 300, career_offer: 30, career_prep: 40, career_followup: 100,
  });
});

test('the owner plan in the migration is ten times every fallback, up to the cap', () => {
  const sql = readFileSync(new URL('../../supabase/migrations/202611120003_plans.sql', import.meta.url), 'utf8');
  const literal = /\('owner',\s*'Owner',\s*'(\{[^']*\})'/.exec(sql)?.[1];
  assert.ok(literal, 'owner seed found');
  const owner = JSON.parse(literal) as Record<string, number>;
  const expected = Object.fromEntries(Object.entries(FALLBACK_LIMITS).map(([feature, value]) => [feature, Math.min(value * 10, RPC_CAPS[feature as keyof typeof RPC_CAPS])]));
  assert.deepEqual(owner, expected);
  for (const [feature, value] of Object.entries(owner)) assert.ok(value <= RPC_CAPS[feature as keyof typeof RPC_CAPS], `${feature} is within its cap`);
});

test('a plan cannot raise a feature past what its claim function accepts', () => {
  assert.equal(limitFor('ask_orbis', { ask_orbis: 200 }), 50);
  assert.equal(limitFor('career_alerts', { career_alerts: 3000 }), 1000);
  assert.equal(limitFor('home_brief', { home_brief: 40 }), 40);
});

test('every fallback is within its cap', () => {
  for (const [feature, value] of Object.entries(FALLBACK_LIMITS)) assert.ok(value <= RPC_CAPS[feature as keyof typeof RPC_CAPS], feature);
});

type Reply = { data: unknown; error: unknown };
function fakeAdmin(replies: Record<string, Reply | 'throw'>) {
  const reads: Array<{ table: string; columns: string; value: unknown }> = [];
  const admin = {
    from: (table: string) => ({
      select: (columns: string) => ({
        eq: (_column: string, value: unknown) => ({
          maybeSingle: async () => {
            reads.push({ table, columns, value });
            const reply = replies[table];
            if (reply === 'throw') throw new Error('network');
            return reply ?? { data: null, error: null };
          },
        }),
      }),
    }),
  } as unknown as Parameters<typeof dailyLimit>[0];
  return Object.assign(admin, { reads });
}

test("dailyLimit reads the person's plan in one embedded read", async () => {
  const admin = fakeAdmin({ account_plans: { data: { plans: { limits: { home_brief: 80 } } }, error: null } });
  assert.equal(await dailyLimit(admin, 'u', 'home_brief'), 80);
  assert.equal(await dailyLimit(admin, 'u', 'ask_orbis'), FALLBACK_LIMITS.ask_orbis);
  assert.deepEqual(admin.reads.map((read) => `${read.table}:${read.columns}`), ['account_plans:plans(limits)', 'account_plans:plans(limits)']);
});

test('dailyLimit accepts the embedded plan as a one-item list too', async () => {
  const admin = fakeAdmin({ account_plans: { data: { plans: [{ limits: { home_brief: 60 } }] }, error: null } });
  assert.equal(await dailyLimit(admin, 'u', 'home_brief'), 60);
});

test('dailyLimit uses the free plan when there is no row, and the fallback when it is empty', async () => {
  const admin = fakeAdmin({ plans: { data: { limits: { health_plan: 12 } }, error: null } });
  assert.equal(await dailyLimit(admin, 'u', 'health_plan'), 12);
  assert.deepEqual(admin.reads.map((read) => [read.table, read.value]), [['account_plans', 'u'], ['plans', 'free']]);
  const empty = fakeAdmin({ plans: { data: { limits: {} }, error: null } });
  assert.equal(await dailyLimit(empty, 'u', 'health_plan'), FALLBACK_LIMITS.health_plan);
});

test('any error gives the fallback', async () => {
  const failed = { data: null, error: { code: '42P01' } };
  assert.equal(await dailyLimit(fakeAdmin({ account_plans: failed }), 'u', 'home_brief'), FALLBACK_LIMITS.home_brief);
  assert.equal(await dailyLimit(fakeAdmin({ plans: failed }), 'u', 'home_brief'), FALLBACK_LIMITS.home_brief);
  assert.equal(await dailyLimit(fakeAdmin({ account_plans: { data: { plans: null }, error: null } }), 'u', 'home_brief'), FALLBACK_LIMITS.home_brief);
  assert.equal(await dailyLimit(fakeAdmin({ account_plans: 'throw' }), 'u', 'home_brief'), FALLBACK_LIMITS.home_brief);
});
