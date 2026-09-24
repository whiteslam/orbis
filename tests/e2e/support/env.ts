import { readFileSync } from 'node:fs';
import path from 'node:path';

// Reads .env.local without printing it. Used only by test setup/teardown.
export function loadEnv(): Record<string, string> {
  const file = path.join(__dirname, '..', '..', '..', '.env.local');
  const env: Record<string, string> = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (match) env[match[1]] = match[2].replace(/^'(.*)'$/, '$1').replace(/^"(.*)"$/, '$1');
  }
  return { ...env, ...process.env } as Record<string, string>;
}

export const AUTH_DIR = path.join(__dirname, '..', '.auth');
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
      for (const folder of folders) {
        const inner = await fetch(`${url}/storage/v1/object/list/health-documents`, { method: 'POST', headers, body: JSON.stringify({ prefix: `${id}/${folder.name}/`, limit: 1000 }) });
        const files = inner.ok ? await inner.json() as Array<{ name: string }> : [];
        const prefixes = files.map((file) => `${id}/${folder.name}/${file.name}`);
        if (prefixes.length) await fetch(`${url}/storage/v1/object/health-documents`, { method: 'DELETE', headers, body: JSON.stringify({ prefixes }) });
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
