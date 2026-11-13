import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asAnon, asUser, bootDb, loadMigration, USER_A, USER_B } from './sql-harness';

const SECRET = 's3cret';
const HASH = createHash('sha256').update(SECRET).digest('hex');
const SIGNAL_1 = '00000000-0000-4000-8000-000000000001';
const SIGNAL_2 = '00000000-0000-4000-8000-000000000002';
const TABLES = ['devices', 'device_sources', 'signals', 'activity_ledger'];

let db: PGlite;
let device: string;

beforeEach(async () => {
  db = await bootDb();
  // Inserted as A, the way the web app registers a phone.
  device = await asUser(db, USER_A, async () => {
    const res = await db.query<{ id: string }>(
      `insert into public.devices (user_id, name, flavour, secret_hash)
       values ($1, 'Pixel', 'direct', $2) returning id`,
      [USER_A, HASH],
    );
    return res.rows[0].id;
  });
}, 30_000);

afterEach(async () => {
  await db.close();
}, 30_000);

type SyncResult = { accepted: number; duplicate: number; refused: number } | null;

async function sync(
  opts: {
    secret?: string;
    meta?: unknown;
    sources?: unknown;
    signals?: unknown;
    ledger?: unknown;
  } = {},
): Promise<SyncResult> {
  const res = await asAnon(db, () =>
    db.query<{ r: SyncResult }>(
      `select public.device_sync($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb) as r`,
      [
        device,
        opts.secret ?? SECRET,
        JSON.stringify(opts.meta ?? {}),
        JSON.stringify(opts.sources ?? []),
        JSON.stringify(opts.signals ?? []),
        JSON.stringify(opts.ledger ?? []),
      ],
    ),
  );
  return res.rows[0].r;
}

async function whoami(secret: string): Promise<string | null> {
  const res = await asAnon(db, () =>
    db.query<{ r: string | null }>(`select public.device_whoami($1, $2) as r`, [device, secret]),
  );
  return res.rows[0].r;
}

async function count(table: string): Promise<number> {
  const res = await db.query<{ n: number }>(`select count(*)::int as n from public.${table}`);
  return res.rows[0].n;
}

async function deviceRow() {
  const res = await db.query<{ v: string | null; t: string | null; seen: boolean }>(
    `select app_version as v, push_token as t, last_seen_at is not null as seen from public.devices`,
  );
  return res.rows[0];
}

const signal = (id: string, source: string) => ({
  id,
  source,
  kind: 'notification',
  occurredAt: '2026-11-12T10:00:00Z',
  content: 'envelope',
});

describe('device schema', () => {
  it("whoami returns A's id for the right secret and null for a wrong one", async () => {
    assert.equal(await whoami(SECRET), USER_A);
    assert.equal(await whoami('wrong'), null);
  });

  it('sync stores a signal from an enabled source and refuses one from a disabled source', async () => {
    const result = await sync({
      sources: [
        { source: 'test', enabled: true },
        { source: 'notifications', enabled: false },
      ],
      signals: [signal(SIGNAL_1, 'test'), signal(SIGNAL_2, 'notifications')],
    });
    assert.deepEqual(result, { accepted: 1, duplicate: 0, refused: 1 });
    assert.equal(await count('signals'), 1);
  });

  it('resending the same batch counts duplicates and stores nothing new', async () => {
    const batch = {
      sources: [{ source: 'test', enabled: true }],
      signals: [signal(SIGNAL_1, 'test')],
    };
    await sync(batch);
    const again = await sync(batch);
    assert.deepEqual(again, { accepted: 0, duplicate: 1, refused: 0 });
    assert.equal(await count('signals'), 1);
  });

  it('sync with 101 signals raises too_many_signals', async () => {
    const many = Array.from({ length: 101 }, (_, i) =>
      signal(`00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, 'test'),
    );
    await assert.rejects(
      sync({ sources: [{ source: 'test', enabled: true }], signals: many }),
      /too_many_signals/,
    );
    assert.equal(await count('signals'), 0);
  });

  it('sync updates last_seen_at, app_version and push_token', async () => {
    await sync({ meta: { appVersion: '1.2.3', pushToken: 'tok' } });
    assert.deepEqual(await deviceRow(), { v: '1.2.3', t: 'tok', seen: true });
    // No pushToken key keeps it; an empty string clears it.
    await sync({ meta: { appVersion: '1.2.4' } });
    assert.deepEqual(await deviceRow(), { v: '1.2.4', t: 'tok', seen: true });
    await sync({ meta: { pushToken: '' } });
    assert.deepEqual(await deviceRow(), { v: '1.2.4', t: null, seen: true });
  });

  it('a push token synced by another phone is taken off the phone that held it before', async () => {
    // A held T; then B (another person's phone, e.g. the same handset after a new sign-in) syncs T.
    await sync({ meta: { pushToken: 'tok-T' } });
    const other = await asUser(db, USER_B, async () => {
      const res = await db.query<{ id: string }>(
        `insert into public.devices (user_id, name, flavour, secret_hash)
         values ($1, 'Pixel', 'play', $2) returning id`,
        [USER_B, HASH],
      );
      return res.rows[0].id;
    });
    await asAnon(db, () =>
      db.query(`select public.device_sync($1, $2, $3::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb)`, [
        other,
        SECRET,
        JSON.stringify({ pushToken: 'tok-T' }),
      ]),
    );
    const tokens = await db.query<{ id: string; t: string | null }>(`select id, push_token as t from public.devices`);
    const tokenOf = (id: string) => tokens.rows.find((row) => row.id === id)?.t;
    assert.equal(tokenOf(device), null);
    assert.equal(tokenOf(other), 'tok-T');
    // A sync with a different token leaves the other phone's token alone.
    await sync({ meta: { pushToken: 'tok-A2' } });
    const after = await db.query<{ t: string | null }>(`select push_token as t from public.devices where id = $1`, [other]);
    assert.equal(after.rows[0].t, 'tok-T');
  });

  it('sync with a wrong secret returns null and stores nothing', async () => {
    const result = await sync({
      secret: 'wrong',
      sources: [{ source: 'test', enabled: true }],
      signals: [signal(SIGNAL_1, 'test')],
    });
    assert.equal(result, null);
    assert.equal(await count('device_sources'), 0);
    assert.equal(await count('signals'), 0);
  });

  it('ledger upsert replaces counts for the same day and source', async () => {
    await sync({
      ledger: [{ day: '2026-11-12', source: 'notifications', kept: 3, dropped: 2, actions: 1 }],
    });
    await sync({
      ledger: [{ day: '2026-11-12', source: 'notifications', kept: 5, dropped: 0, actions: 4 }],
    });
    const res = await db.query<{ kept: number; dropped: number; actions: number }>(
      'select kept, dropped, actions from public.activity_ledger',
    );
    assert.equal(res.rows.length, 1);
    assert.deepEqual(res.rows[0], { kept: 5, dropped: 0, actions: 4 });
  });

  it('a revoked device: revoke returns true, then whoami and sync return null', async () => {
    const revoke = async (secret: string) =>
      (
        await asAnon(db, () =>
          db.query<{ r: boolean }>(`select public.device_revoke($1, $2) as r`, [device, secret]),
        )
      ).rows[0].r;
    assert.equal(await revoke('wrong'), false);
    assert.equal(await revoke(SECRET), true);
    assert.equal(await whoami(SECRET), null);
    assert.equal(await sync(), null);
    // Already revoked: false, and it does not trip the one-way trigger.
    assert.equal(await revoke(SECRET), false);
  });

  it('clearing revoked_at is refused', async () => {
    await asUser(db, USER_A, async () => {
      await db.query('update public.devices set revoked_at = now() where id = $1', [device]);
      await assert.rejects(
        db.query('update public.devices set revoked_at = null where id = $1', [device]),
        /revoked/i,
      );
    });
    assert.equal(await whoami(SECRET), null);
  });

  it("as B, A's signals, devices and ledger are invisible", async () => {
    await sync({
      sources: [{ source: 'test', enabled: true }],
      signals: [signal(SIGNAL_1, 'test')],
      ledger: [{ day: '2026-11-12', source: 'test', kept: 1, dropped: 0, actions: 0 }],
    });
    await asUser(db, USER_B, async () => {
      // Granted columns only, so a zero here is the RLS policy talking.
      for (const q of [
        'select id, name from public.devices',
        'select device_id, source from public.device_sources',
        'select id from public.signals',
        'select day from public.activity_ledger',
      ]) {
        assert.equal((await db.query(q)).rows.length, 0, q);
      }
      // B can neither rename nor revoke A's device.
      const upd = await db.query(
        `update public.devices set name = 'x' where id = $1 returning id`,
        [device],
      );
      assert.equal(upd.rows.length, 0);
    });
    await asUser(db, USER_A, async () => {
      assert.equal((await db.query('select id from public.devices')).rows.length, 1);
      assert.equal((await db.query('select id from public.signals')).rows.length, 1);
      assert.equal((await db.query('select day from public.activity_ledger')).rows.length, 1);
    });
  });

  it('as A, selecting secret_hash from devices is denied', async () => {
    await asUser(db, USER_A, async () => {
      await assert.rejects(db.query('select secret_hash from public.devices'), /permission denied/);
      await assert.rejects(db.query('select push_token from public.devices'), /permission denied/);
      await assert.rejects(db.query('select * from public.devices'), /permission denied/);
      await assert.rejects(
        db.query('update public.devices set secret_hash = $1 where id = $2', [HASH, device]),
        /permission denied/,
      );
      const ok = await db.query('select id, name, revoked_at from public.devices');
      assert.equal(ok.rows.length, 1);
    });
  });

  it('as A, a new device cannot arrive revoked and sources and signals cannot be inserted', async () => {
    await asUser(db, USER_A, async () => {
      await assert.rejects(
        db.query(
          `insert into public.devices (user_id, name, flavour, secret_hash, revoked_at)
           values ($1, 'X', 'play', $2, now())`,
          [USER_A, HASH],
        ),
        /row-level security/,
      );
      await assert.rejects(
        db.query(
          `insert into public.signals (user_id, id, source, kind, occurred_at, content)
           values ($1, $2, 'test', 'notification', now(), 'x')`,
          [USER_A, SIGNAL_1],
        ),
        /permission denied/,
      );
      await assert.rejects(
        db.query(
          `insert into public.device_sources (device_id, user_id, source, enabled)
           values ($1, $2, 'test', true)`,
          [device, USER_A],
        ),
        /permission denied/,
      );
    });
  });

  it('as A, registering a device for user B is refused', async () => {
    await asUser(db, USER_A, async () => {
      await assert.rejects(
        db.query(
          `insert into public.devices (user_id, name, flavour, secret_hash)
           values ($1, 'Sneaky', 'play', $2)`,
          [USER_B, HASH],
        ),
        /row-level security/,
      );
    });
  });

  it('as anon, selecting from devices and signals returns nothing or is denied', async () => {
    await sync({
      sources: [{ source: 'test', enabled: true }],
      signals: [signal(SIGNAL_1, 'test')],
    });
    await asAnon(db, async () => {
      for (const table of ['devices', 'device_sources', 'signals', 'activity_ledger']) {
        await assert.rejects(db.query(`select * from public.${table}`), /permission denied/, table);
      }
    });
  });

  it("deleting user A removes A's devices, sources, signals and ledger", async () => {
    await sync({
      sources: [{ source: 'test', enabled: true }],
      signals: [signal(SIGNAL_1, 'test')],
      ledger: [{ day: '2026-11-12', source: 'test', kept: 1, dropped: 0, actions: 0 }],
    });
    for (const table of TABLES) assert.equal(await count(table), 1, table);
    await db.query('delete from auth.users where id = $1', [USER_A]);
    for (const table of TABLES) assert.equal(await count(table), 0, table);
  });

  it('the migration can be run twice', async () => {
    await loadMigration(db);
    assert.equal(await whoami(SECRET), USER_A);
  });
});
