import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { afterAll, beforeAll, test } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { bootDb, USER_A, USER_B } from './sql-harness.ts';

// 202611130003_youtube_post_times.sql: more than one post time a day.

const POST_TIMES = fileURLToPath(new URL('../../supabase/migrations/202611130003_youtube_post_times.sql', import.meta.url));
const runPostTimes = (db: PGlite) => db.exec(readFileSync(POST_TIMES, 'utf8'));

let db: PGlite;
beforeAll(async () => {
  db = await bootDb();
  // A schedule saved before the migration keeps its one time.
  await db.query(`insert into public.youtube_settings (user_id, post_time) values ($1, '07:45')`, [USER_A]);
  await runPostTimes(db);
}, 60_000);
afterAll(async () => { await db?.close(); });

test('an existing schedule gets its post_time as its only post time', async () => {
  const res = await db.query<{ post_times: string[] }>(`select post_times::text[] as post_times from public.youtube_settings where user_id = $1`, [USER_A]);
  assert.deepEqual(res.rows[0].post_times, ['07:45:00']);
});

test('a new schedule starts at 18:00, and one to six times are allowed', async () => {
  await db.query(`insert into public.youtube_settings (user_id) values ($1)`, [USER_B]);
  const fresh = await db.query<{ post_times: string[] }>(`select post_times::text[] as post_times from public.youtube_settings where user_id = $1`, [USER_B]);
  assert.deepEqual(fresh.rows[0].post_times, ['18:00:00']);
  await db.query(`update public.youtube_settings set post_times = '{09:00,12:00,15:00,18:00,20:00,22:00}' where user_id = $1`, [USER_B]);
  await assert.rejects(db.query(`update public.youtube_settings set post_times = '{}' where user_id = $1`, [USER_B]), /check constraint/i);
  await assert.rejects(
    db.query(`update public.youtube_settings set post_times = '{01:00,02:00,03:00,04:00,05:00,06:00,07:00}' where user_id = $1`, [USER_B]),
    /check constraint/i,
  );
});

test('running it twice is safe', async () => {
  await runPostTimes(db);
  const res = await db.query<{ post_times: string[] }>(`select post_times::text[] as post_times from public.youtube_settings where user_id = $1`, [USER_A]);
  assert.deepEqual(res.rows[0].post_times, ['07:45:00']);
});
