import { readFileSync } from 'node:fs';
import { e2eEnv } from './env-files';
import path from 'node:path';

// Reads .env.local, then .env.test.local (staging) over it, without printing either.
// Used only by test setup/teardown.
export function loadEnv(): Record<string, string> {
  return e2eEnv();
}

// E2E_AUTH_DIR lets runs that overlap keep their own users: each run deletes
// its users and this folder when it ends, which would sign out the others.
export const AUTH_DIR = process.env.E2E_AUTH_DIR ?? path.join(__dirname, '..', '.auth');
export const USERS_FILE = path.join(AUTH_DIR, 'users.json');
// Device PIN for test users (not a weak pattern, so the PIN rules accept it).
export const TEST_PIN = '583921';

export type TestUser = { id: string; email: string; password: string; storageState: string };
export type TestUsers = { a: TestUser; b: TestUser };

export function readUsers(): TestUsers {
  return JSON.parse(readFileSync(USERS_FILE, 'utf8')) as TestUsers;
}

export function supabaseAdmin() {
  const env = loadEnv();
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error('Supabase URL/secret missing in .env.local');
  const headers = { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' };
  return {
    url,
    publishableKey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    async createUser(email: string, password: string) {
      const response = await fetch(`${url}/auth/v1/admin/users`, { method: 'POST', headers, body: JSON.stringify({ email, password, email_confirm: true }) });
      const body = await response.json() as { id?: string; msg?: string };
      if (!response.ok || !body.id) throw new Error(`Could not create test user: ${response.status} ${body.msg ?? ''}`);
      return body.id;
    },
    async deleteUser(id: string) {
      await fetch(`${url}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers });
    },
    // Rows cascade with the auth user; storage objects do not, so remove them first.
    async deleteUserFiles(id: string) {
      const list = await fetch(`${url}/storage/v1/object/list/health-documents`, { method: 'POST', headers, body: JSON.stringify({ prefix: `${id}/`, limit: 1000 }) });
      if (!list.ok) return;
      const folders = await list.json() as Array<{ name: string }>;
      await Promise.all(folders.map(async (folder) => {
        const inner = await fetch(`${url}/storage/v1/object/list/health-documents`, { method: 'POST', headers, body: JSON.stringify({ prefix: `${id}/${folder.name}/`, limit: 1000 }) });
        const files = inner.ok ? await inner.json() as Array<{ name: string }> : [];
        const prefixes = files.map((file) => `${id}/${folder.name}/${file.name}`);
        if (prefixes.length) await fetch(`${url}/storage/v1/object/health-documents`, { method: 'DELETE', headers, body: JSON.stringify({ prefixes }) });
      }));
    },
    // Deletes rows matching a PostgREST filter (e.g. `user_id=eq.<id>`), to give a test a known starting state.
    async deleteRows(table: string, filter: string) {
      const response = await fetch(`${url}/rest/v1/${table}?${filter}`, { method: 'DELETE', headers });
      if (!response.ok) throw new Error(`Could not clear ${table}: ${response.status}`);
    },
    // Reads rows matching a PostgREST query (e.g. `select=entry_date&user_id=eq.<id>`).
    async selectRows<T = Record<string, unknown>>(table: string, query: string): Promise<T[]> {
      const response = await fetch(`${url}/rest/v1/${table}?${query}`, { headers });
      if (!response.ok) throw new Error(`Could not read ${table}: ${response.status}`);
      return await response.json() as T[];
    },
    // Inserts a row, or replaces the one with the same primary key.
    async upsertRow(table: string, row: Record<string, unknown>) {
      const response = await fetch(`${url}/rest/v1/${table}`, { method: 'POST', headers: { ...headers, prefer: 'resolution=merge-duplicates' }, body: JSON.stringify(row) });
      if (!response.ok) {
        // The PostgREST error code rides along, so a caller can tell a missing table from a real failure.
        const body = await response.json().catch(() => ({})) as { code?: string; message?: string };
        throw Object.assign(new Error(`Could not write ${table}: ${response.status} ${body.code ?? ''} ${body.message ?? ''}`.trim()), { code: body.code });
      }
    },
    // Signs in as a test user with the public key: what a browser holding that user's session could do.
    async userToken(email: string, password: string) {
      const response = await fetch(`${url}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const body = await response.json() as { access_token?: string };
      if (!body.access_token) throw new Error('Test user sign-in failed');
      return body.access_token;
    },
  };
}
