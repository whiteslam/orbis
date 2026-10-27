import { test } from 'vitest';
import assert from 'node:assert/strict';
import { joinWaitlist, WAITLIST_INVALID, WAITLIST_UNAVAILABLE } from './join-waitlist';

// A stand-in for the table: unique emails, ignore-duplicates on insert.
function fakeTable(existing: string[] = []) {
  const rows = new Set(existing);
  return { rows, allow: async () => true, add: async (email: string) => { rows.add(email); return { error: null }; } };
}

test('a throttled or unchecked caller is refused and nothing is written', async () => {
  const table = fakeTable();
  assert.deepEqual(await joinWaitlist({ email: 'x@example.test' }, { ...table, allow: async () => false }), { ok: false, message: WAITLIST_UNAVAILABLE });
  const broken = { ...table, allow: async () => { throw new Error('rate limit down'); } };
  assert.deepEqual(await joinWaitlist({ email: 'y@example.test' }, broken), { ok: false, message: WAITLIST_UNAVAILABLE });
  assert.equal(table.rows.size, 0);
});

test('a listed and an unlisted address get the same answer', async () => {
  const table = fakeTable(['a@example.test', 'b@example.test']);
  const listed = await joinWaitlist({ email: 'A@example.test' }, table);
  const fresh = await joinWaitlist({ email: 'new@example.test' }, table);
  assert.deepEqual(listed, { ok: true });
  assert.deepEqual(fresh, listed);
  assert.equal(table.rows.size, 3);
});

test('a bad address or a failed write is refused plainly', async () => {
  assert.deepEqual(await joinWaitlist({ email: 'nope' }, fakeTable()), { ok: false, message: WAITLIST_INVALID });
  assert.deepEqual(await joinWaitlist(null, fakeTable()), { ok: false, message: WAITLIST_INVALID });
  const failing = { allow: async () => true, add: async () => ({ error: new Error('down') }) };
  assert.deepEqual(await joinWaitlist({ email: 'x@example.test' }, failing), { ok: false, message: WAITLIST_UNAVAILABLE });
});

test('the honeypot answers like a success and writes nothing', async () => {
  const table = fakeTable();
  assert.deepEqual(await joinWaitlist({ email: 'bot@example.test', website: 'spam' }, table), { ok: true });
  assert.equal(table.rows.size, 0);
});
