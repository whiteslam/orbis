import { expect, test } from '@playwright/test';
import { readUsers, supabaseAdmin } from '../support/env';

// Data isolation at the database boundary (Supabase REST with each user's own
// session token, exactly what a browser holding that session could send).

const today = new Date().toISOString().slice(0, 10);

// One minimal row per user-writable table. `key` is the primary-key column used to target the row.
const USER_TABLES: Array<{ table: string; key: string; row: (userId: string) => Record<string, unknown>; update: Record<string, unknown> }> = [
  { table: 'transactions', key: 'id', row: (id) => ({ user_id: id, amount: 42, currency: 'INR', direction: 'expense', occurred_at: new Date().toISOString(), source: 'manual', merchant: 'QA isolation' }), update: { amount: 1 } },
  { table: 'goals', key: 'id', row: (id) => ({ user_id: id, title: 'QA isolation goal', target_value: 10 }), update: { title: 'hijacked' } },
  { table: 'habits', key: 'id', row: (id) => ({ user_id: id, title: 'QA isolation habit' }), update: { title: 'hijacked' } },
  { table: 'user_context_notes', key: 'id', row: (id) => ({ user_id: id, note: 'QA private note' }), update: { note: 'hijacked' } },
  { table: 'investment_holdings', key: 'id', row: (id) => ({ user_id: id, name: 'QA fund', asset_type: 'fund', quantity: 1, value_per_unit: 1, currency: 'INR', value_as_of: today }), update: { name: 'hijacked' } },
  { table: 'user_fitness_personas', key: 'user_id', row: (id) => ({ user_id: id, persona: 'QA persona' }), update: { persona: 'hijacked' } },
  { table: 'user_personal_profiles', key: 'user_id', row: (id) => ({ user_id: id, preferred_name: 'QA' }), update: { preferred_name: 'hijacked' } },
  { table: 'user_locations', key: 'user_id', row: (id) => ({ user_id: id, city: 'QA City', latitude: 18.5, longitude: 73.8 }), update: { city: 'hijacked' } },
  { table: 'journal_entries', key: 'id', row: (id) => ({ user_id: id, entry_date: today, mood: 4, body: 'QA private journal' }), update: { body: 'hijacked' } },
  { table: 'notification_preferences', key: 'user_id', row: (id) => ({ user_id: id, enabled: true }), update: { enabled: false } },
  { table: 'health_daily_steps', key: 'id', row: (id) => ({ user_id: id, date: today, steps: 1234, source: 'apple_health_export' }), update: { steps: 1 } },
  // Added with the schedule the Home brief reads. A routine says when you are
  // at the gym and an event says whether you went, so both are as private as
  // anything above them.
  { table: 'routines', key: 'id', row: (id) => ({ user_id: id, title: 'QA gym', kind: 'workout', at_time: '19:00', days: [1, 2, 3] }), update: { title: 'hijacked' } },
  { table: 'routine_events', key: 'id', row: (id) => ({ user_id: id, routine_id: null, title: 'QA gym', local_date: today, status: 'done' }), update: { status: 'skipped' } },
  { table: 'ai_preferences', key: 'user_id', row: (id) => ({ user_id: id, home_brief_enabled: true }), update: { home_brief_enabled: false } },
];

// Tables that hold secrets or server bookkeeping: no signed-in user may read them directly.
const SERVER_ONLY = ['gmail_connections', 'gmail_sync_messages', 'user_app_pins', 'api_cache', 'api_provider_status', 'api_daily_usage', 'workbook_ai_usage', 'ai_generation_events'];

test.describe('database isolation between users', () => {
  let tokenA = '';
  let tokenB = '';
  let url = '';
  let publishable = '';
  const created: Record<string, string> = {};
  // Tables whose migration is not applied on this database.
  const missing: string[] = [];

  const rest = (token: string | null, path: string, init: RequestInit = {}) => fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: publishable, ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json', prefer: 'return=representation', ...(init.headers ?? {}) },
  });

  test.beforeAll(async () => {
    const admin = supabaseAdmin();
    url = admin.url;
    publishable = admin.publishableKey;
    const users = readUsers();
    tokenA = await admin.userToken(users.a.email, users.a.password);
    tokenB = await admin.userToken(users.b.email, users.b.password);
    for (const spec of USER_TABLES) {
      const response = await rest(tokenA, spec.table, { method: 'POST', body: JSON.stringify(spec.row(users.a.id)) });
      const body = await response.json();
      // A table whose migration has not been applied is reported and skipped
      // rather than failing the seed: one pending migration should not take
      // every other table's isolation check down with it.
      if (response.status === 404 && body?.code === 'PGRST205') {
        missing.push(spec.table);
        continue;
      }
      expect(response.status, `${spec.table} insert as owner: ${JSON.stringify(body).slice(0, 200)}`).toBe(201);
      created[spec.table] = String(body[0][spec.key]);
    }
  });

  // Remove A's probe rows so later UI tests start from a clean account.
  test.afterAll(async () => {
    for (const spec of USER_TABLES) {
      if (created[spec.table]) await rest(tokenA, `${spec.table}?${spec.key}=eq.${created[spec.table]}`, { method: 'DELETE' });
    }
  });

  for (const spec of USER_TABLES) {
    test(`${spec.table}: user B cannot read, change, delete or forge user A's rows`, async () => {
      test.skip(missing.includes(spec.table), `${spec.table} does not exist yet: apply its migration, then re-run.`);
      const users = readUsers();
      const target = `${spec.table}?${spec.key}=eq.${created[spec.table]}`;

      const read = await rest(tokenB, target);
      expect(await read.json()).toEqual([]);

      const update = await rest(tokenB, target, { method: 'PATCH', body: JSON.stringify(spec.update) });
      expect(await update.json()).toEqual([]);

      const remove = await rest(tokenB, target, { method: 'DELETE' });
      expect(await remove.json()).toEqual([]);

      // Writing a row that claims to belong to A must be rejected by RLS.
      const forged = await rest(tokenB, spec.table, { method: 'POST', body: JSON.stringify({ ...spec.row(users.a.id), ...(spec.key === 'user_id' ? {} : {}) }) });
      expect([401, 403, 409]).toContain(forged.status);

      const anonymous = await rest(null, target);
      expect([200, 401]).toContain(anonymous.status);
      if (anonymous.status === 200) expect(await anonymous.json()).toEqual([]);

      // A's row is untouched.
      const own = await rest(tokenA, target);
      const rows = await own.json();
      expect(rows).toHaveLength(1);
      for (const [column, value] of Object.entries(spec.update)) expect(rows[0][column]).not.toEqual(value);
    });
  }

  for (const table of SERVER_ONLY) {
    test(`${table}: not readable with a user session or anonymously`, async () => {
      for (const token of [tokenB, null]) {
        const response = await rest(token, `${table}?select=*&limit=1`);
        if (response.status === 200) expect(await response.json()).toEqual([]);
        else expect([401, 403, 404]).toContain(response.status);
      }
    });
  }
});
