import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { afterAll, beforeAll, test } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootDb, USER_A } from '../youtube/sql-harness.ts';

// 202611140002_shorts_shelf.sql: the build window, days to keep ready, where to
// post, and the guarded counter that limits how many shorts start each day.
const file = (name: string) => fileURLToPath(new URL(`../../supabase/migrations/${name}`, import.meta.url));
const AUTOPILOT = file('202611140001_shorts_autopilot.sql');
const SHELF = file('202611140002_shorts_shelf.sql');
const run = (db: PGlite, path: string) => db.exec(readFileSync(path, 'utf8'));

let db: PGlite;
beforeAll(async () => {
  db = await bootDb();
  await run(db, AUTOPILOT);
  await db.query(`insert into public.shorts_autopilot (user_id, start_time) values ($1, '09:00')`, [USER_A]);
  await run(db, SHELF);
}, 60_000);
afterAll(async () => { await db?.close(); });

const start = async (today: string, cap: number) =>
  (await db.query<{ ok: boolean }>(`select public.shorts_autopilot_start($1, $2::date, $3) as ok`, [USER_A, today, cap])).rows[0].ok;

test('the existing row moves to a 23:00–07:00 window, 3 days, YouTube', async () => {
  const res = await db.query(
    `select start_time::text, window_end::text, shelf_days, destinations from public.shorts_autopilot where user_id = $1`, [USER_A]);
  assert.deepEqual(res.rows[0], { start_time: '23:00:00', window_end: '07:00:00', shelf_days: 3, destinations: ['youtube'] });
});

test('re-running the migration keeps a later window', async () => {
  await db.query(`update public.shorts_autopilot set start_time = '22:00' where user_id = $1`, [USER_A]);
  await run(db, SHELF);
  const res = await db.query<{ start_time: string }>(`select start_time::text from public.shorts_autopilot where user_id = $1`, [USER_A]);
  assert.equal(res.rows[0].start_time, '22:00:00');
});

test('the start guard counts per local day and stops at the cap', async () => {
  await db.query(`update public.shorts_autopilot set enabled = true where user_id = $1`, [USER_A]);
  assert.deepEqual([await start('2026-11-14', 2), await start('2026-11-14', 2), await start('2026-11-14', 2)], [true, true, false]);
  assert.equal(await start('2026-11-15', 2), true);
  const res = await db.query<{ started_count: number; started_on: string }>(
    `select started_count, started_on::text from public.shorts_autopilot where user_id = $1`, [USER_A]);
  assert.deepEqual(res.rows[0], { started_count: 1, started_on: '2026-11-15' });
});

test('the start guard refuses while off', async () => {
  await db.query(`update public.shorts_autopilot set enabled = false where user_id = $1`, [USER_A]);
  assert.equal(await start('2026-11-20', 5), false);
});

test('bad values are refused', async () => {
  await assert.rejects(db.query(`update public.shorts_autopilot set shelf_days = 0 where user_id = $1`, [USER_A]), /check constraint/i);
  await assert.rejects(db.query(`update public.shorts_autopilot set destinations = '{tiktok}' where user_id = $1`, [USER_A]), /check constraint/i);
});

test('people can’t call the start guard', async () => {
  await assert.rejects(asUser(db, USER_A, () => start('2026-11-21', 5)), /permission denied/i);
});
