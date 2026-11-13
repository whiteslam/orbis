import { beforeEach, test, vi } from 'vitest';
import assert from 'node:assert/strict';

// The web's Settings → What Orbis can see, before the phone tables' migration is applied
// (main deploys on merge; the owner applies the migration separately).

type Reply = { data?: unknown; error: { code?: string; message?: string } | null };

const db = vi.hoisted(() => ({ replies: new Map<string, Reply>(), calls: [] as string[] }));

/** A query chain: every builder call returns itself, and awaiting it gives the table's reply. */
function chain(table: string, op: string): unknown {
  db.calls.push(`${op}:${table}`);
  const reply = db.replies.get(table) ?? { data: [], error: null };
  const target = {
    then: (resolve: (value: Reply) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(reply).then(resolve, reject),
  };
  const proxy: unknown = new Proxy(target, {
    get(object, key) {
      if (key === 'then') return object.then;
      return () => proxy;
    },
  });
  return proxy;
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getClaims: async () => ({ data: { claims: { sub: '11111111-1111-4111-8111-111111111111' } }, error: null }) },
    from: (table: string) => ({
      select: () => chain(table, 'select'),
      delete: () => chain(table, 'delete'),
      update: () => chain(table, 'update'),
    }),
  }),
}));
vi.mock('@/lib/security/app-lock', () => ({ isAppUnlocked: async () => true }));

const { deleteSourceData, listDevices } = await import('@/app/personal/device-actions');

const MISSING = { code: 'PGRST205', message: "Could not find the table 'public.devices' in the schema cache" };
const NO_RELATION = { code: '42P01', message: 'relation "public.signals" does not exist' };

beforeEach(() => {
  db.replies.clear();
  db.calls.length = 0;
});

test('with no phone tables yet, the phone list is empty rather than an error', async () => {
  db.replies.set('devices', { data: null, error: MISSING });
  assert.deepEqual(await listDevices(), []);
});

test('with devices but no device_sources table, each phone reads nothing', async () => {
  const row = { id: 'd1', name: 'Pixel', flavour: 'play', last_seen_at: null, created_at: '2026-11-12T00:00:00Z', revoked_at: null };
  db.replies.set('devices', { data: [row], error: null });
  db.replies.set('device_sources', { data: null, error: NO_RELATION });
  const phones = await listDevices();
  assert.equal(phones.length, 1);
  assert.deepEqual(phones[0].sources, []);
});

test('any other read failure still rejects', async () => {
  db.replies.set('devices', { data: null, error: { code: '57014', message: 'timeout' } });
  await assert.rejects(listDevices(), /could not be loaded/);
});

test('deleting what was kept is a quiet success when there is nothing set up to delete', async () => {
  db.replies.set('signals', { error: MISSING });
  db.replies.set('activity_ledger', { error: NO_RELATION });
  const result = await deleteSourceData('test');
  assert.equal(result.success, true);
  assert.deepEqual(db.calls, ['delete:signals', 'delete:activity_ledger']);
});

test('a real delete failure is still reported', async () => {
  db.replies.set('signals', { error: { code: '42501', message: 'permission denied' } });
  const result = await deleteSourceData('test');
  assert.equal(result.success, false);
});
