import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { afterAll, beforeAll, test } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootDb, USER_A, USER_B } from '../youtube/sql-harness.ts';

// 202611140001_shorts_autopilot.sql: one row per person, read by its owner only.
const MIGRATION = fileURLToPath(new URL('../../supabase/migrations/202611140001_shorts_autopilot.sql', import.meta.url));
const run = (db: PGlite) => db.exec(readFileSync(MIGRATION, 'utf8'));

let db: PGlite;
beforeAll(async () => {
  db = await bootDb();
  await run(db);
}, 60_000);
afterAll(async () => { await db?.close(); });

test('a new row starts off, Cozy Tales at 09:00, never run', async () => {
  await db.query(`insert into public.shorts_autopilot (user_id) values ($1), ($2)`, [USER_A, USER_B]);
  const res = await db.query<{ enabled: boolean; style: string; start_time: string; last_run_on: string | null }>(
    `select enabled, style, start_time::text, last_run_on from public.shorts_autopilot where user_id = $1`, [USER_A]);
  assert.deepEqual(res.rows[0], { enabled: false, style: 'cozy-tales', start_time: '09:00:00', last_run_on: null });
});

test('people read only their own row and can’t write it', async () => {
  const seen = await asUser(db, USER_A, async () => (await db.query<{ user_id: string }>(`select user_id from public.shorts_autopilot`)).rows);
  assert.deepEqual(seen.map((row) => row.user_id), [USER_A]);
  await assert.rejects(asUser(db, USER_A, () => db.query(`update public.shorts_autopilot set enabled = true where user_id = $1`, [USER_A])), /permission denied/i);
});

test('a bad style is refused, and running it twice is safe', async () => {
  await assert.rejects(db.query(`update public.shorts_autopilot set style = 'Not A Slug' where user_id = $1`, [USER_A]), /check constraint/i);
  await run(db);
  const res = await db.query(`select count(*)::int as n from public.shorts_autopilot`);
  assert.equal((res.rows[0] as { n: number }).n, 2);
});
