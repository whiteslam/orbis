// Test helper: boots an in-process Postgres (PGlite) with just enough of
// Supabase stubbed (auth.users, auth.uid(), the anon, authenticated and
// service_role roles) to load the real migration files unchanged and exercise
// RLS, grants and the queue functions.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

export const USER_A = '11111111-1111-4111-8111-111111111111';
export const USER_B = '22222222-2222-4222-8222-222222222222';

function migrationPath(name: string): string {
  return fileURLToPath(new URL(`../../supabase/migrations/${name}`, import.meta.url));
}

const YOUTUBE_MIGRATION = migrationPath('202611130002_youtube.sql');

// The migrations this one builds on, in the order they were applied.
const PRIOR_MIGRATIONS = [
  migrationPath('202610010027_social_connections.sql'),
  migrationPath('202611100001_shorts.sql'),
];

const STUBS = `
  create role anon nologin;
  create role authenticated nologin;
  -- Like Supabase, the service role bypasses row level security.
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  -- Same idea as Supabase: auth.uid() reads the JWT subject claim setting.
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant usage on schema auth to anon, authenticated;
  grant usage on schema public to anon, authenticated, service_role;
  -- Supabase auto-grants every new public table, function and sequence to anon
  -- and authenticated; the migration's revokes exist to undo that. Model it so
  -- those revokes are actually exercised.
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on functions to anon, authenticated;
  alter default privileges in schema public grant all on sequences to anon, authenticated;

  create function public.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table public.social_posts (id uuid primary key default gen_random_uuid());
`;

/** (Re)run the YouTube migration; it is written to be safe to run twice. */
export function loadMigration(db: PGlite): Promise<unknown> {
  return db.exec(readFileSync(YOUTUBE_MIGRATION, 'utf8'));
}

/** A fresh database with the stubs, users A and B, and the migrations the YouTube tables build on. */
export async function bootDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(STUBS);
  await db.query('insert into auth.users (id, email) values ($1, $2), ($3, $4)', [
    USER_A,
    'a@example.com',
    USER_B,
    'b@example.com',
  ]);
  for (const file of PRIOR_MIGRATIONS) await db.exec(readFileSync(file, 'utf8'));
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
