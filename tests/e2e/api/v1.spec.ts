import { expect, test, type APIRequestContext } from '@playwright/test';
import { readUsers } from '../support/env';

// /api/v1 end to end: sign in for tokens, call the app's actions and reads with
// them, and check one user's token never reaches another user's rows.

async function signIn(request: APIRequestContext, key: 'a' | 'b') {
  const { email, password } = readUsers()[key];
  const response = await request.post('/api/v1/auth/token', { data: { email, password } });
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body).toMatchObject({ tokenType: 'bearer', accessToken: expect.any(String), refreshToken: expect.any(String) });
  return body as { accessToken: string; refreshToken: string };
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

test('the index lists what the API offers, without a token', async ({ request }) => {
  const response = await request.get('/api/v1');
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.actions).toContain('POST /api/v1/actions/social.loadMonth');
  expect(body.data).toContain('GET /api/v1/data/finance');
  // Kept to the app: nothing that signs in, sends mail or deletes the account.
  expect(body.actions.join(' ')).not.toMatch(/sendApplication|deleteAccount|unlock|setPin|connectBroker/);
});

test('calls without a valid token are refused', async ({ request }) => {
  expect((await request.get('/api/v1/data/notes')).status()).toBe(401);
  expect((await request.get('/api/v1/data/notes', { headers: { authorization: 'Bearer a.b.c' } })).status()).toBe(401);
  expect((await request.post('/api/v1/actions/personal.addNote', { data: { args: ['x'] } })).status()).toBe(401);
});

test('a wrong password gets no tokens', async ({ request }) => {
  const response = await request.post('/api/v1/auth/token', { data: { email: readUsers().a.email, password: 'not-the-password-1!' } });
  expect(response.status()).toBe(401);
  expect(await response.json()).not.toHaveProperty('accessToken');
});

test('a token runs actions and reads as its own user, and only theirs', async ({ request }) => {
  const a = await signIn(request, 'a');
  const b = await signIn(request, 'b');
  const note = `API note ${Date.now()}`;

  const added = await request.post('/api/v1/actions/personal.addNote', { headers: bearer(a.accessToken), data: { args: [note] } });
  expect(added.status()).toBe(200);

  const mine = await (await request.get('/api/v1/data/notes', { headers: bearer(a.accessToken) })).json();
  const saved = mine.data.notes.find((item: { note: string }) => item.note === note);
  expect(saved).toBeTruthy();

  const theirs = await (await request.get('/api/v1/data/notes', { headers: bearer(b.accessToken) })).json();
  expect(JSON.stringify(theirs.data)).not.toContain(note);

  // B can't delete A's note: the row isn't B's, so nothing happens to it.
  await request.post('/api/v1/actions/personal.deleteNote', { headers: bearer(b.accessToken), data: { args: [saved.id] } });
  const still = await (await request.get('/api/v1/data/notes', { headers: bearer(a.accessToken) })).json();
  expect(still.data.notes.some((item: { id: string }) => item.id === saved.id)).toBe(true);

  const removed = await request.post('/api/v1/actions/personal.deleteNote', { headers: bearer(a.accessToken), data: { args: [saved.id] } });
  expect(removed.status()).toBe(200);
});

test('a refused action answers 422 in its own words, and bad requests are explained', async ({ request }) => {
  const { accessToken } = await signIn(request, 'a');
  const refused = await request.post('/api/v1/actions/social.loadMonth', { headers: bearer(accessToken), data: { args: ['not-a-month'] } });
  expect(refused.status()).toBe(422);
  expect((await refused.json()).result).toMatchObject({ success: false });

  const month = await request.post('/api/v1/actions/social.loadMonth', { headers: bearer(accessToken), data: { args: ['2026-10-01'] } });
  expect(month.status()).toBe(200);
  expect((await month.json()).result).toMatchObject({ success: true, posts: expect.any(Array) });

  expect((await request.post('/api/v1/actions/account.delete', { headers: bearer(accessToken) })).status()).toBe(404);
  expect((await request.get('/api/v1/data/nope', { headers: bearer(accessToken) })).status()).toBe(404);
  expect((await request.post('/api/v1/actions/social.loadMonth', { headers: bearer(accessToken), data: '{"args": 5}' })).status()).toBe(400);
});

test('a refresh token is swapped for a working pair', async ({ request }) => {
  const { refreshToken } = await signIn(request, 'a');
  const response = await request.post('/api/v1/auth/refresh', { data: { refreshToken } });
  expect(response.status()).toBe(200);
  const next = await response.json();
  expect(next.refreshToken).not.toBe(refreshToken);
  expect((await request.get('/api/v1/data/profile', { headers: bearer(next.accessToken) })).status()).toBe(200);
});
