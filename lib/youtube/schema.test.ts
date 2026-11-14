import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootDb, loadMigration, USER_A, USER_B } from './sql-harness';

let db: PGlite;

beforeEach(async () => {
  db = await bootDb();
}, 30_000);

afterEach(async () => {
  await db.close();
}, 30_000);

async function newJob(userId: string): Promise<string> {
  const res = await db.query<{ id: string }>(
    `insert into public.shorts_jobs (user_id, style, topic) values ($1, 'tall-tale', 'a topic') returning id`,
    [userId],
  );
  return res.rows[0].id;
}

async function enqueue(
  userId: string,
  position: number,
  opts: { jobId?: string | null; title?: string } = {},
): Promise<string> {
  const res = await db.query<{ id: string }>(
    `insert into public.youtube_queue (user_id, job_id, video_path, title, category_id, privacy, position)
     values ($1, $2, $3, $4, '24', 'public', $5) returning id`,
    [userId, opts.jobId ?? null, `${userId}/v${position}.mp4`, opts.title ?? `Short ${position}`, position],
  );
  return res.rows[0].id;
}

async function positions(userId: string): Promise<Record<string, number>> {
  const res = await db.query<{ id: string; position: number }>(
    `select id, position from public.youtube_queue where user_id = $1`,
    [userId],
  );
  return Object.fromEntries(res.rows.map((r) => [r.id, r.position]));
}

describe('social_connections', () => {
  it('accepts platform youtube with a refresh token', async () => {
    await db.query(
      `insert into public.social_connections
         (user_id, platform, access_token_encrypted, refresh_token_encrypted, account_id)
       values ($1, 'youtube', 'enc-access', 'enc-refresh', 'UC123')`,
      [USER_A],
    );
    const res = await db.query<{ refresh_token_encrypted: string }>(
      `select refresh_token_encrypted from public.social_connections where platform = 'youtube'`,
    );
    assert.equal(res.rows[0].refresh_token_encrypted, 'enc-refresh');
  });

  it('still refuses an unknown platform', async () => {
    await assert.rejects(
      db.query(
        `insert into public.social_connections (user_id, platform, access_token_encrypted, account_id)
         values ($1, 'tiktok', 'x', 'y')`,
        [USER_A],
      ),
      /check constraint/i,
    );
  });
});

describe('row access', () => {
  it('a person reads only their own youtube_queue, settings and presets rows', async () => {
    await enqueue(USER_A, 1);
    await enqueue(USER_B, 1);
    await db.query(`insert into public.youtube_settings (user_id) values ($1), ($2)`, [USER_A, USER_B]);
    await db.query(
      `insert into public.youtube_presets (user_id, style) values ($1, 'tall-tale'), ($2, 'tall-tale')`,
      [USER_A, USER_B],
    );

    const seen = await asUser(db, USER_A, async () => ({
      queue: (await db.query<{ user_id: string }>(`select user_id from public.youtube_queue`)).rows,
      settings: (await db.query<{ user_id: string }>(`select user_id from public.youtube_settings`)).rows,
      presets: (await db.query<{ user_id: string }>(`select user_id from public.youtube_presets`)).rows,
    }));
    assert.deepEqual(
      seen.queue.map((r) => r.user_id),
      [USER_A],
    );
    assert.deepEqual(
      seen.settings.map((r) => r.user_id),
      [USER_A],
    );
    assert.deepEqual(
      seen.presets.map((r) => r.user_id),
      [USER_A],
    );
  });

  it('authenticated cannot insert, update or delete youtube_queue', async () => {
    const id = await enqueue(USER_A, 1);
    await asUser(db, USER_A, async () => {
      await assert.rejects(
        db.query(
          `insert into public.youtube_queue (user_id, video_path, title, category_id, privacy, position)
           values ($1, 'p.mp4', 't', '24', 'public', 2)`,
          [USER_A],
        ),
        /permission denied/i,
      );
      await assert.rejects(
        db.query(`update public.youtube_queue set title = 'x' where id = $1`, [id]),
        /permission denied/i,
      );
      await assert.rejects(
        db.query(`delete from public.youtube_queue where id = $1`, [id]),
        /permission denied/i,
      );
    });
  });
});

describe('queue rules', () => {
  it("a short can't be queued twice while queued or published, but can again after removed", async () => {
    const job = await newJob(USER_A);
    const first = await enqueue(USER_A, 1, { jobId: job });
    await assert.rejects(enqueue(USER_A, 2, { jobId: job }), /unique|duplicate/i);

    await db.query(`update public.youtube_queue set status = 'published' where id = $1`, [first]);
    await assert.rejects(enqueue(USER_A, 2, { jobId: job }), /unique|duplicate/i);

    await db.query(`update public.youtube_queue set status = 'removed' where id = $1`, [first]);
    await enqueue(USER_A, 2, { jobId: job });
  });

  it('deleting the shorts job sets job_id null and keeps the queue row', async () => {
    const job = await newJob(USER_A);
    const row = await enqueue(USER_A, 1, { jobId: job });
    await db.query(`delete from public.shorts_jobs where id = $1`, [job]);
    const res = await db.query<{ id: string; job_id: string | null }>(
      `select id, job_id from public.youtube_queue where id = $1`,
      [row],
    );
    assert.equal(res.rows.length, 1);
    assert.equal(res.rows[0].job_id, null);
  });

  it('days must be a non-empty subset of 1–7', async () => {
    await assert.rejects(
      db.query(`insert into public.youtube_settings (user_id, days) values ($1, '{0}')`, [USER_A]),
      /check constraint/i,
    );
    await assert.rejects(
      db.query(`insert into public.youtube_settings (user_id, days) values ($1, '{}')`, [USER_A]),
      /check constraint/i,
    );
    await assert.rejects(
      db.query(`insert into public.youtube_settings (user_id, days) values ($1, '{8}')`, [USER_A]),
      /check constraint/i,
    );
    await db.query(`insert into public.youtube_settings (user_id, days) values ($1, '{1,3,5}')`, [USER_A]);
  });

  it('settings default to 18:00, every day, not paused', async () => {
    await db.query(`insert into public.youtube_settings (user_id) values ($1)`, [USER_A]);
    const res = await db.query<{ post_time: string; days: number[]; timezone: string; paused: boolean }>(
      `select post_time::text, days, timezone, paused from public.youtube_settings`,
    );
    assert.equal(res.rows[0].post_time, '18:00:00');
    assert.deepEqual(res.rows[0].days, [1, 2, 3, 4, 5, 6, 7]);
    assert.equal(res.rows[0].timezone, 'Asia/Kolkata');
    assert.equal(res.rows[0].paused, false);
  });

  it('the migration runs twice without error', async () => {
    await loadMigration(db);
    await loadMigration(db);
    await enqueue(USER_A, 1);
  });
});

describe('youtube_take_row', () => {
  type Row = {
    id: string;
    status: string;
    posted_by: string | null;
    lease_until: string | null;
    upload_started_at: string | null;
  };

  async function take(userId: string, id: string, from: string, by = 'schedule', secs = 75): Promise<Row[]> {
    const res = await db.query<Row>(`select * from public.youtube_take_row($1, $2, $3, $4, $5)`, [
      userId,
      id,
      from,
      by,
      secs,
    ]);
    return res.rows;
  }

  it('youtube_take_row moves queued to uploading, sets posted_by and a lease; a second take while the lease is live returns no row; after the lease passes it returns the row', async () => {
    const id = await enqueue(USER_A, 1);

    const first = await take(USER_A, id, 'queued', 'manual');
    assert.equal(first.length, 1);
    assert.equal(first[0].status, 'uploading');
    assert.equal(first[0].posted_by, 'manual');
    assert.ok(first[0].lease_until);
    assert.ok(first[0].upload_started_at);

    // Neither a second claim from queued nor a resume while the lease is live gets the row.
    assert.equal((await take(USER_A, id, 'queued')).length, 0);
    assert.equal((await take(USER_A, id, 'uploading')).length, 0);

    await db.query(`update public.youtube_queue set lease_until = now() - interval '1 second' where id = $1`, [id]);
    const resumed = await take(USER_A, id, 'uploading', 'schedule');
    assert.equal(resumed.length, 1);
    assert.equal(resumed[0].status, 'uploading');
    // Resuming keeps who started it and when.
    assert.equal(resumed[0].posted_by, 'manual');
    assert.equal(
      new Date(resumed[0].upload_started_at as string).getTime(),
      new Date(first[0].upload_started_at as string).getTime(),
    );
    assert.ok(new Date(resumed[0].lease_until as string).getTime() > Date.now());
  });

  it("does not take another person's row", async () => {
    const id = await enqueue(USER_A, 1);
    assert.equal((await take(USER_B, id, 'queued')).length, 0);
  });
});

describe('youtube_move', () => {
  async function move(userId: string, id: string, dir: number): Promise<void> {
    await db.query(`select public.youtube_move($1, $2, $3)`, [userId, id, dir]);
  }

  it("youtube_move swaps with the neighbour and does nothing at the ends or for another user's row", async () => {
    const a = await enqueue(USER_A, 1);
    const b = await enqueue(USER_A, 5);
    const c = await enqueue(USER_A, 9);
    const other = await enqueue(USER_B, 2);

    await move(USER_A, b, -1);
    assert.deepEqual(await positions(USER_A), { [a]: 5, [b]: 1, [c]: 9 });

    // b is now first: moving earlier is a no-op.
    await move(USER_A, b, -1);
    assert.deepEqual(await positions(USER_A), { [a]: 5, [b]: 1, [c]: 9 });

    // c is last: moving later is a no-op.
    await move(USER_A, c, 1);
    assert.deepEqual(await positions(USER_A), { [a]: 5, [b]: 1, [c]: 9 });

    await move(USER_A, a, 1);
    assert.deepEqual(await positions(USER_A), { [a]: 9, [b]: 1, [c]: 5 });

    // A direction other than +-1 is ignored.
    await move(USER_A, a, 2);
    await move(USER_A, a, 0);
    assert.deepEqual(await positions(USER_A), { [a]: 9, [b]: 1, [c]: 5 });

    // Someone else's row is untouched, and so is their neighbour.
    await move(USER_A, other, -1);
    await move(USER_B, a, 1);
    assert.deepEqual(await positions(USER_B), { [other]: 2 });
    assert.deepEqual(await positions(USER_A), { [a]: 9, [b]: 1, [c]: 5 });
  });

  it('skips rows that are not queued when finding the neighbour', async () => {
    const a = await enqueue(USER_A, 1);
    const b = await enqueue(USER_A, 2);
    const c = await enqueue(USER_A, 3);
    await db.query(`update public.youtube_queue set status = 'uploading' where id = $1`, [b]);
    await move(USER_A, c, -1);
    assert.deepEqual(await positions(USER_A), { [a]: 3, [b]: 2, [c]: 1 });
  });
});

describe('function privileges', () => {
  it('authenticated cannot execute youtube_take_row or youtube_move', async () => {
    const id = await enqueue(USER_A, 1);
    await asUser(db, USER_A, async () => {
      await assert.rejects(
        db.query(`select * from public.youtube_take_row($1, $2, 'queued', 'manual', 75)`, [USER_A, id]),
        /permission denied/i,
      );
      await assert.rejects(db.query(`select public.youtube_move($1, $2, 1)`, [USER_A, id]), /permission denied/i);
    });
  });

  it('service_role can execute both', async () => {
    const id = await enqueue(USER_A, 1);
    await db.exec('set role service_role');
    try {
      const taken = await db.query(`select * from public.youtube_take_row($1, $2, 'queued', 'manual', 75)`, [
        USER_A,
        id,
      ]);
      assert.equal(taken.rows.length, 1);
      await db.query(`select public.youtube_move($1, $2, 1)`, [USER_A, id]);
    } finally {
      await db.exec('reset role');
    }
  });
});
