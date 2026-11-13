import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'vitest';
import { MAX_BODY_BYTES } from './http';
import { readBodyCapped, revokeWithCredential, syncDevice, type SyncResult } from './service';

const ID = '7b0f6c1e-3a52-4c8e-9d41-2f6a8b1c0001';
const SECRET = 'A'.repeat(43);
const HEADER = `Device ${ID}.${SECRET}`;
const USER = '11111111-2222-4333-8444-555555555555';
const NOW = new Date('2026-11-12T12:00:00Z');
const BODY = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tests/fixtures/device-sync.json'), 'utf8');
const FIXTURE = JSON.parse(BODY) as { signals: { id: string; content: string }[] };
const RESULT: SyncResult = { accepted: 2, duplicate: 0, refused: 0 };

type Deps = Parameters<typeof syncDevice>[0];
type SyncArgs = Parameters<Deps['sync']>[0];

function deps(patch: Partial<Deps> = {}) {
  const calls = { whoami: [] as unknown[][], sync: [] as SyncArgs[], encrypt: [] as unknown[][] };
  const d: Deps = {
    whoami: async (id, secret) => {
      calls.whoami.push([id, secret]);
      return USER;
    },
    sync: async (args) => {
      calls.sync.push(args);
      return RESULT;
    },
    ready: () => true,
    encrypt: (userId, text, context) => {
      calls.encrypt.push([userId, text, context]);
      return `p1.nonce.tag.${Buffer.from(text).toString('base64url')}`;
    },
    ...patch,
  };
  return { d, calls };
}

describe('syncDevice', () => {
  it('answers 401 to a missing or malformed header, before anything else', async () => {
    for (const header of [null, '', 'Bearer abc', `Device ${ID}`, `Device ${ID}.short`]) {
      const { d, calls } = deps();
      const out = await syncDevice(d, header, BODY, NOW);
      assert.equal(out.status, 401, String(header));
      assert.equal(calls.whoami.length, 0);
    }
  });

  it('answers 503 when the server has no phone-data key', async () => {
    const { d, calls } = deps({ ready: () => false });
    const out = await syncDevice(d, HEADER, BODY, NOW);
    assert.equal(out.status, 503);
    assert.deepEqual(out.body, { error: 'Phone sync is not set up on the server yet.' });
    assert.equal(calls.sync.length, 0);
  });

  it('answers 400 with the parser message', async () => {
    const { d, calls } = deps();
    const out = await syncDevice(d, HEADER, '{"signals": 5}', NOW);
    assert.equal(out.status, 400);
    assert.deepEqual(out.body, { error: 'signals must be a list' });
    assert.equal(calls.sync.length, 0);
  });

  it('answers 401 when whoami does not know the phone', async () => {
    const { d, calls } = deps({ whoami: async () => null });
    const out = await syncDevice(d, HEADER, BODY, NOW);
    assert.equal(out.status, 401);
    assert.equal(calls.sync.length, 0);
    assert.equal(calls.encrypt.length, 0);
  });

  it('encrypts each signal bound to its id and never sends the plaintext', async () => {
    const { d, calls } = deps();
    await syncDevice(d, HEADER, BODY, NOW);
    assert.equal(calls.sync.length, 1);
    const args = calls.sync[0];
    assert.equal(args.deviceId, ID);
    assert.equal(args.secret, SECRET);
    assert.equal(args.signals.length, FIXTURE.signals.length);
    args.signals.forEach((s, i) => {
      assert.ok(s.content.startsWith('p1.'));
      assert.notEqual(s.content, FIXTURE.signals[i].content);
      assert.ok(!s.content.includes(FIXTURE.signals[i].content));
      assert.equal(calls.encrypt[i][0], USER);
      assert.equal(calls.encrypt[i][1], FIXTURE.signals[i].content);
      assert.equal(calls.encrypt[i][2], s.id);
    });
    assert.deepEqual(Object.keys(args.signals[0]).sort(), ['content', 'id', 'kind', 'occurredAt', 'source']);
    assert.deepEqual(args.meta, { appVersion: '0.1.0', pushToken: 'fcm-token-fixture-0001' });
    assert.deepEqual(args.sources, [{ source: 'test', enabled: true }]);
    assert.equal(args.ledger.length, 1);
  });

  it('encrypts and sends a signal id in lowercase even when the phone sent it uppercase', async () => {
    const upper = FIXTURE.signals[0].id.toUpperCase();
    const body = JSON.stringify({ ...JSON.parse(BODY), signals: [{ ...JSON.parse(BODY).signals[0], id: upper }] });
    const { d, calls } = deps();
    await syncDevice(d, HEADER, body, NOW);
    assert.equal(calls.encrypt[0][2], FIXTURE.signals[0].id);
    assert.equal(calls.sync[0].signals[0].id, FIXTURE.signals[0].id);
  });

  it('answers 401 when sync says the phone is not verified', async () => {
    const { d } = deps({ sync: async () => null });
    assert.equal((await syncDevice(d, HEADER, BODY, NOW)).status, 401);
  });

  it('answers 200 with the RPC result', async () => {
    const { d } = deps();
    const out = await syncDevice(d, HEADER, BODY, NOW);
    assert.equal(out.status, 200);
    assert.deepEqual(out.body, RESULT);
  });

  it('answers 500, without leaking content, when sync, encrypt or whoami throws', async () => {
    const secretText = FIXTURE.signals[0].content;
    const patches: Partial<Deps>[] = [
      {
        sync: async () => {
          throw new Error(`boom ${secretText} ${SECRET}`);
        },
      },
      {
        encrypt: () => {
          throw new Error(`boom ${secretText}`);
        },
      },
      {
        whoami: async () => {
          throw new Error('boom');
        },
      },
    ];
    for (const patch of patches) {
      const { d } = deps(patch);
      const logged: unknown[][] = [];
      const original = console.error;
      console.error = (...a: unknown[]) => void logged.push(a);
      try {
        const out = await syncDevice(d, HEADER, BODY, NOW);
        assert.equal(out.status, 500);
        assert.ok(!JSON.stringify(out.body).includes(secretText));
      } finally {
        console.error = original;
      }
      const text = JSON.stringify(logged.map((a) => a.map(String)));
      assert.ok(!text.includes(secretText) && !text.includes(SECRET));
    }
  });
});

describe('revokeWithCredential', () => {
  it('answers 204 when the phone was revoked', async () => {
    const seen: unknown[][] = [];
    const out = await revokeWithCredential(
      {
        revoke: async (id, secret) => {
          seen.push([id, secret]);
          return true;
        },
      },
      HEADER,
    );
    assert.equal(out.status, 204);
    assert.deepEqual(seen, [[ID, SECRET]]);
  });
  it('answers 401 when revoke returns false', async () => {
    assert.equal((await revokeWithCredential({ revoke: async () => false }, HEADER)).status, 401);
  });
  it('answers 401 to a bad header without calling revoke', async () => {
    let called = false;
    const out = await revokeWithCredential(
      {
        revoke: async () => {
          called = true;
          return true;
        },
      },
      'nope',
    );
    assert.equal(out.status, 401);
    assert.equal(called, false);
  });
  it('answers 500 when revoke throws', async () => {
    const original = console.error;
    console.error = () => {};
    try {
      const out = await revokeWithCredential(
        {
          revoke: async () => {
            throw new Error('x');
          },
        },
        HEADER,
      );
      assert.equal(out.status, 500);
    } finally {
      console.error = original;
    }
  });
});

describe('readBodyCapped', () => {
  const req = (body: BodyInit | null, headers: Record<string, string> = {}) =>
    new Request('http://localhost/x', { method: 'POST', body, headers, duplex: 'half' } as RequestInit);

  it('reads a body within the cap', async () => {
    assert.equal(await readBodyCapped(req('{"a":1}'), 100), '{"a":1}');
  });
  it('reads an empty body as an empty string', async () => {
    assert.equal(await readBodyCapped(req(null), 100), '');
  });
  it('refuses a declared Content-Length over the cap without reading', async () => {
    const r = req('x', { 'content-length': String(MAX_BODY_BYTES + 1) });
    assert.equal(await readBodyCapped(r, MAX_BODY_BYTES), null);
  });
  it('refuses a body that really is over the cap, whatever it declares', async () => {
    assert.equal(await readBodyCapped(req('x'.repeat(101), { 'content-length': '5' }), 100), null);
    assert.equal(await readBodyCapped(req('x'.repeat(101)), 100), null);
  });
  it('stops reading a stream once it passes the cap', async () => {
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new Uint8Array(60));
        if (pulls > 50) controller.close();
      },
    });
    assert.equal(await readBodyCapped(req(stream), 100), null);
    assert.ok(pulls < 10, `pulled ${pulls} times`);
  });
  it('counts bytes, not characters', async () => {
    assert.equal(await readBodyCapped(req('é'.repeat(60)), 100), null);
    assert.equal((await readBodyCapped(req('é'.repeat(50)), 100))?.length, 50);
  });
});
