import { beforeEach, describe, expect, it, vi } from 'vitest';

const USER = '11111111-1111-4111-8111-111111111111';
const ROW = '33333333-3333-4333-8333-333333333333';

const fake = vi.hoisted(() => ({ filters: [] as string[], reply: { data: { id: 'x' } as unknown, error: null as unknown } }));

function chain(): unknown {
  const proxy: unknown = new Proxy({}, {
    get(_o, key) {
      if (key === 'eq') return (column: string, value: unknown) => { fake.filters.push(`eq:${column}=${String(value)}`); return proxy; };
      if (key === 'in') return (column: string, values: unknown[]) => { fake.filters.push(`in:${column}=${values.join(',')}`); return proxy; };
      if (key === 'maybeSingle') return () => Promise.resolve(fake.reply);
      return () => proxy;
    },
  });
  return proxy;
}

vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('@/lib/gmail/connection', () => ({ disconnectGmail: async () => ({}) }));
vi.mock('@/lib/auth/session', () => ({ getAuthenticatedUserId: async () => USER }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ from: () => ({ delete: () => chain() }) }) }));

const { deleteManualTransactionAction } = await import('@/app/finance/actions');
const { isDeletableSource } = await import('@/lib/finance/manual');

beforeEach(() => {
  fake.filters.length = 0;
  fake.reply = { data: { id: ROW }, error: null };
});

describe('deleting a transaction you added or accepted', () => {
  it('covers manual and phone rows, scoped to the row and the person', async () => {
    const result = await deleteManualTransactionAction(ROW);
    expect(result).toEqual({ success: true, message: 'Transaction deleted.' });
    expect(fake.filters).toEqual([`eq:id=${ROW}`, `eq:user_id=${USER}`, 'in:source=manual,phone']);
  });

  it('reports a row it could not delete (such as a Gmail row)', async () => {
    fake.reply = { data: null, error: null };
    expect((await deleteManualTransactionAction(ROW)).success).toBe(false);
  });

  it('knows which sources are deletable', () => {
    expect(isDeletableSource('manual')).toBe(true);
    expect(isDeletableSource('phone')).toBe(true);
    expect(isDeletableSource('gmail')).toBe(false);
  });
});
