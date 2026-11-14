import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { acceptPhoneTransaction, dismissPhoneTransaction, listPhoneTransactions, readTransactionSignal } = await import('@/lib/finance/phone-review');
const { encryptForUser } = await import('@/lib/crypto/user-keys');

const USER = '11111111-1111-4111-8111-111111111111';
const SIGNAL = '33333333-3333-4333-8333-333333333333';
const GOOD = JSON.stringify({ v: 1, app: 'com.google.android.apps.messaging', text: 'Rs 1250.00 spent at SWIGGY', amount: '1250.00', currency: 'INR', direction: 'expense', merchant: 'SWIGGY' });

type Reply = { data?: unknown; error: { code?: string; message?: string } | null };

const fake = vi.hoisted(() => ({
  replies: new Map<string, Reply>(),
  calls: [] as string[],
  filters: [] as string[],
  inserted: [] as Array<Record<string, unknown>>,
  insertReplies: [] as Reply[],
}));

/** A query chain: every builder call returns itself; awaiting it gives the operation's reply. */
function chain(table: string, op: string): unknown {
  fake.calls.push(`${op}:${table}`);
  const reply = fake.replies.get(`${op}:${table}`) ?? { data: op === 'select' ? [] : null, error: null };
  const target = { then: (resolve: (v: Reply) => unknown, reject: (r: unknown) => unknown) => Promise.resolve(reply).then(resolve, reject) };
  const proxy: unknown = new Proxy(target, {
    get(object, key) {
      if (key === 'then') return object.then;
      if (key === 'eq') return (column: string, value: unknown) => { fake.filters.push(`${op}:${table}:${column}=${String(value)}`); return proxy; };
      if (key === 'maybeSingle') return () => Promise.resolve({ data: Array.isArray(reply.data) ? (reply.data[0] ?? null) : reply.data ?? null, error: reply.error });
      return () => proxy;
    },
  });
  return proxy;
}

const db = {
  from: (table: string) => ({
    select: () => chain(table, 'select'),
    delete: () => chain(table, 'delete'),
    insert: (row: Record<string, unknown>) => {
      fake.inserted.push(row);
      fake.calls.push(`insert:${table}`);
      return Promise.resolve(fake.insertReplies.shift() ?? { error: null });
    },
  }),
} as never;

function signalRow(json = GOOD, id = SIGNAL) {
  return { id, occurred_at: '2026-11-14T08:30:00Z', content: encryptForUser(USER, json, id) };
}

beforeEach(() => {
  vi.stubEnv('ORBIS_PHONE_DATA_KEY', Buffer.alloc(32, 9).toString('base64'));
  fake.replies.clear();
  fake.calls.length = 0;
  fake.filters.length = 0;
  fake.inserted.length = 0;
  fake.insertReplies.length = 0;
});

describe('readTransactionSignal', () => {
  it('reads a good signal', () => {
    expect(readTransactionSignal(SIGNAL, '2026-11-14T08:30:00Z', GOOD)).toEqual({
      signalId: SIGNAL,
      amount: 1250,
      currency: 'INR',
      direction: 'expense',
      merchant: 'SWIGGY',
      occurredAt: '2026-11-14T08:30:00Z',
      text: 'Rs 1250.00 spent at SWIGGY',
    });
  });

  it('allows a missing merchant', () => {
    const json = JSON.stringify({ v: 1, app: null, text: 'x', amount: '5', currency: 'INR', direction: 'income' });
    expect(readTransactionSignal(SIGNAL, 't', json)?.merchant).toBeNull();
  });

  it.each([
    ['bad JSON', '{nope'],
    ['v 2', JSON.stringify({ ...JSON.parse(GOOD), v: 2 })],
    ['amount 0', JSON.stringify({ ...JSON.parse(GOOD), amount: '0' })],
    ['amount "abc"', JSON.stringify({ ...JSON.parse(GOOD), amount: 'abc' })],
    ['amount above the cap', JSON.stringify({ ...JSON.parse(GOOD), amount: '100000001' })],
    ['direction "transfer"', JSON.stringify({ ...JSON.parse(GOOD), direction: 'transfer' })],
    ['currency "rupees"', JSON.stringify({ ...JSON.parse(GOOD), currency: 'rupees' })],
  ])('refuses %s', (_name, json) => {
    expect(readTransactionSignal(SIGNAL, 't', json)).toBeNull();
  });
});

describe('listPhoneTransactions', () => {
  it('decrypts each signal, skips unreadable ones, and logs once without content', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    fake.replies.set('select:signals', { error: null, data: [signalRow(), { id: 'b', occurred_at: 't', content: 'p1.junk' }, signalRow('{nope', '44444444-4444-4444-8444-444444444444')] });
    const list = await listPhoneTransactions(db, USER);
    expect(list.map((t) => t.signalId)).toEqual([SIGNAL]);
    expect(error).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(error.mock.calls)).not.toContain('SWIGGY');
    expect(fake.filters).toContain(`select:signals:user_id=${USER}`);
    expect(fake.filters).toContain('select:signals:source=notifications');
    expect(fake.filters).toContain('select:signals:kind=transaction');
    error.mockRestore();
  });

  it('reads a missing signals table as empty', async () => {
    fake.replies.set('select:signals', { data: null, error: { code: '42P01', message: 'relation "public.signals" does not exist' } });
    expect(await listPhoneTransactions(db, USER)).toEqual([]);
    fake.replies.set('select:signals', { data: null, error: { code: 'PGRST205' } });
    expect(await listPhoneTransactions(db, USER)).toEqual([]);
  });
});

describe('acceptPhoneTransaction', () => {
  it('saves the server-read amount, tied to the signal, then deletes the signal', async () => {
    fake.replies.set('select:signals', { error: null, data: [signalRow()] });
    // The input type has no amount field at all; a client-sent one is ignored.
    const input = { signalId: SIGNAL, category: 'Food & dining', amount: '1', currency: 'USD' } as { signalId: string; category: string };
    const result = await acceptPhoneTransaction(db, USER, input);
    expect(result).toEqual({ success: true, message: 'Expense saved.' });
    expect(fake.inserted).toEqual([{
      user_id: USER,
      amount: 1250,
      currency: 'INR',
      direction: 'expense',
      merchant: 'SWIGGY',
      category: 'Food & dining',
      occurred_at: '2026-11-14T08:30:00.000Z',
      source: 'phone',
      source_signal_id: SIGNAL,
      source_message_id: null,
      payment_method: null,
      note: null,
    }]);
    expect(fake.calls).toContain('delete:signals');
    expect(fake.filters).toContain(`delete:signals:id=${SIGNAL}`);
    expect(fake.filters).toContain(`delete:signals:user_id=${USER}`);
  });

  it('accepting twice saves one row: a duplicate reads as already saved and still clears the signal', async () => {
    fake.replies.set('select:signals', { error: null, data: [signalRow()] });
    fake.insertReplies.push({ error: null }, { error: { code: '23505', message: 'duplicate key' } });
    const first = await acceptPhoneTransaction(db, USER, { signalId: SIGNAL, category: 'Other' });
    fake.calls.length = 0;
    const second = await acceptPhoneTransaction(db, USER, { signalId: SIGNAL, category: 'Other' });
    expect(first.success).toBe(true);
    expect(second).toEqual({ success: true, message: 'Already in Money.' });
    expect(fake.calls).toContain('delete:signals');
  });

  it('lets the person change merchant and direction, checking the category for that direction', async () => {
    fake.replies.set('select:signals', { error: null, data: [signalRow()] });
    const wrong = await acceptPhoneTransaction(db, USER, { signalId: SIGNAL, category: 'Food & dining', direction: 'income' });
    expect(wrong.success).toBe(false);
    expect(fake.inserted).toHaveLength(0);
    const right = await acceptPhoneTransaction(db, USER, { signalId: SIGNAL, category: 'Refund', direction: 'income', merchant: '  Swiggy refund ' });
    expect(right).toEqual({ success: true, message: 'Income saved.' });
    expect(fake.inserted[0]).toMatchObject({ direction: 'income', category: 'Refund', merchant: 'Swiggy refund' });
  });

  it('refuses an unknown category or a bad signal id without touching the database', async () => {
    expect((await acceptPhoneTransaction(db, USER, { signalId: SIGNAL, category: 'Nope' })).success).toBe(false);
    expect((await acceptPhoneTransaction(db, USER, { signalId: 'x', category: 'Other' })).success).toBe(false);
    expect(fake.calls).toEqual([]);
  });

  it('keeps the signal when the payment cannot be saved', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    fake.replies.set('select:signals', { error: null, data: [signalRow()] });
    fake.insertReplies.push({ error: { code: '42703', message: 'column source_signal_id does not exist' } });
    const result = await acceptPhoneTransaction(db, USER, { signalId: SIGNAL, category: 'Other' });
    expect(result.success).toBe(false);
    expect(fake.calls).not.toContain('delete:signals');
    error.mockRestore();
  });

  it('says so when the payment is no longer waiting', async () => {
    fake.replies.set('select:signals', { error: null, data: [] });
    const result = await acceptPhoneTransaction(db, USER, { signalId: SIGNAL, category: 'Other' });
    expect(result.success).toBe(false);
    expect(fake.inserted).toHaveLength(0);
  });
});

describe('dismissPhoneTransaction', () => {
  it('deletes only this person’s signal', async () => {
    const result = await dismissPhoneTransaction(db, USER, SIGNAL);
    expect(result.success).toBe(true);
    expect(fake.filters).toEqual([`delete:signals:id=${SIGNAL}`, `delete:signals:user_id=${USER}`, 'delete:signals:source=notifications', 'delete:signals:kind=transaction']);
  });

  it('refuses a bad id', async () => {
    expect((await dismissPhoneTransaction(db, USER, 'x')).success).toBe(false);
    expect(fake.calls).toEqual([]);
  });
});
