import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { afterAll, beforeAll, test } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { bootDb, USER_A, USER_B } from '../youtube/sql-harness.ts';

// 202611140004_shorts_autopilot_styles.sql, on top of the two autopilot migrations before it.
const file = (name: string) => readFileSync(fileURLToPath(new URL(`../../supabase/migrations/${name}`, import.meta.url)), 'utf8');
const STYLES = '202611140004_shorts_autopilot_styles.sql';

let db: PGlite;
beforeAll(async () => {
  db = await bootDb();
  await db.exec(file('202611140001_shorts_autopilot.sql'));
  await db.exec(file('202611140002_shorts_shelf.sql'));
  // A row saved before this migration keeps its one style.
  await db.query(`insert into public.shorts_autopilot (user_id, style) values ($1, 'cozy-tales')`, [USER_A]);
  await db.exec(file(STYLES));
}, 60_000);
afterAll(async () => { await db?.close(); });

const stylesOf = async (user: string) =>
  (await db.query<{ styles: string[] }>(`select styles from public.shorts_autopilot where user_id = $1`, [user])).rows[0].styles;

test('an existing row gets its style as its only style, and a new row starts with bedtime stories', async () => {
  assert.deepEqual(await stylesOf(USER_A), ['cozy-tales']);
  await db.query(`insert into public.shorts_autopilot (user_id) values ($1)`, [USER_B]);
  assert.deepEqual(await stylesOf(USER_B), ['cozy-tales']);
});

test('takes both kinds, refuses an unknown style or none, and runs twice safely', async () => {
  await db.query(`update public.shorts_autopilot set styles = '{cozy-tales,tall-tale}' where user_id = $1`, [USER_A]);
  assert.deepEqual(await stylesOf(USER_A), ['cozy-tales', 'tall-tale']);
  await assert.rejects(db.query(`update public.shorts_autopilot set styles = '{deep-dive}' where user_id = $1`, [USER_A]), /check constraint/i);
  await assert.rejects(db.query(`update public.shorts_autopilot set styles = '{}' where user_id = $1`, [USER_A]), /check constraint/i);
  await db.exec(file(STYLES));
  assert.deepEqual(await stylesOf(USER_A), ['cozy-tales', 'tall-tale']);
});
