// Test helper: boots an in-process Postgres (PGlite) with just enough of
// Supabase stubbed (auth.users, auth.uid(), the anon and authenticated roles)
// to load the real migration files unchanged and exercise RLS and grants.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

export const USER_A = '11111111-1111-4111-8111-111111111111';
export const USER_B = '22222222-2222-4222-8222-222222222222';

const MIGRATION = fileURLToPath(
  new URL('../../supabase/migrations/202611120004_devices.sql', import.meta.url),
);

const STUBS = `
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  -- Same idea as Supabase: auth.uid() reads the JWT subject claim setting.
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant usage on schema auth to anon, authenticated;
  grant usage on schema public to anon, authenticated;
  -- Supabase auto-grants every new public table, function and sequence to anon
  -- and authenticated; the migration's revokes exist to undo that. Model it so
  -- those revokes are actually exercised.
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on functions to anon, authenticated;
  alter default privileges in schema public grant all on sequences to anon, authenticated;
`;

export function loadMigration(db: PGlite): Promise<unknown> {
  return db.exec(readFileSync(MIGRATION, 'utf8'));
}

/** A fresh database with the stubs, users A and B, and the devices migration. */
export async function bootDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(STUBS);
  await db.query('insert into auth.users (id, email) values ($1, $2), ($3, $4)', [
    USER_A,
    'a@example.com',
    USER_B,
    'b@example.com',
  ]);
  await loadMigration(db);
  return db;
}

/** Run fn as the signed-in person (role authenticated, auth.uid() = userId). */
export async function asUser<T>(db: PGlite, userId: string, fn: () => Promise<T>): Promise<T> {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId]);
  await db.exec('set role authenticated');
  try {
    return await fn();
  } finally {
    await db.exec('reset role');
    await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
  }
}

/** Run fn as the sessionless client (role anon, no user). */
export async function asAnon<T>(db: PGlite, fn: () => Promise<T>): Promise<T> {
  await db.exec('set role anon');
  try {
    return await fn();
  } finally {
    await db.exec('reset role');
  }
}
