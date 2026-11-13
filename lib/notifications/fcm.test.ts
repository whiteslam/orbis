import { createVerify, generateKeyPairSync } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { fcmConfigured, fcmJwtClaims, fcmMessage, fcmOutcome, resetFcmCache, sendFcm } = await import('@/lib/notifications/fcm');
const { pushToUser } = await import('@/lib/notifications/push');

// A throwaway key, generated per run. Nothing here is ever a real credential.
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PRIVATE_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const ACCOUNT = { project_id: 'orbis-test', client_email: 'push@orbis-test.iam.gserviceaccount.com', private_key: PRIVATE_PEM };
const encode = (value: unknown) => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64');
const ENV = { FCM_SERVICE_ACCOUNT: encode(ACCOUNT) };
const PAYLOAD = { title: 'Morning', body: 'Two things today', tag: 'orbis-morning', url: '/?notifications=open' };

describe('fcmConfigured', () => {
  it('is true for a base64 service account with a usable key', () => {
    expect(fcmConfigured(ENV)).toBe(true);
  });

  it('is false when unset, empty, not base64 JSON, or missing fields', () => {
    expect(fcmConfigured({})).toBe(false);
    expect(fcmConfigured({ FCM_SERVICE_ACCOUNT: '  ' })).toBe(false);
    expect(fcmConfigured({ FCM_SERVICE_ACCOUNT: '%%% not base64 %%%' })).toBe(false);
    expect(fcmConfigured({ FCM_SERVICE_ACCOUNT: encode('{"oops"') })).toBe(false);
    expect(fcmConfigured({ FCM_SERVICE_ACCOUNT: encode({ ...ACCOUNT, project_id: undefined }) })).toBe(false);
    expect(fcmConfigured({ FCM_SERVICE_ACCOUNT: encode({ ...ACCOUNT, client_email: 5 }) })).toBe(false);
  });

  it('is false when the private key is not a key', () => {
    expect(fcmConfigured({ FCM_SERVICE_ACCOUNT: encode({ ...ACCOUNT, private_key: 'not a pem' }) })).toBe(false);
  });
});

describe('fcmJwtClaims', () => {
  it('names the account, the messaging scope and the token endpoint, valid for an hour', () => {
    expect(fcmJwtClaims({ client_email: 'a@b.c' }, 1_000)).toEqual({
      iss: 'a@b.c',
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: 1_000,
      exp: 4_600,
    });
  });
});

describe('fcmMessage', () => {
  it('builds a high-priority notification for the orbis channel carrying the link', () => {
    expect(fcmMessage('tok', PAYLOAD)).toEqual({
      message: {
        token: 'tok',
        notification: { title: 'Morning', body: 'Two things today' },
        android: { priority: 'high', notification: { channel_id: 'orbis', tag: 'orbis-morning' } },
        data: { url: '/?notifications=open' },
      },
    });
  });
});

describe('fcmOutcome', () => {
  it('maps the response to sent, gone or failed', () => {
    expect(fcmOutcome(200, { name: 'projects/x/messages/1' })).toBe('sent');
    expect(fcmOutcome(404, { error: { details: [{ errorCode: 'UNREGISTERED' }] } })).toBe('gone');
    expect(fcmOutcome(404, null)).toBe('failed');
    expect(fcmOutcome(404, { error: { status: 'NOT_FOUND' } })).toBe('failed');
    expect(fcmOutcome(400, { error: { details: [{ errorCode: 'INVALID_ARGUMENT' }, { errorCode: 'UNREGISTERED' }] } })).toBe('gone');
    expect(fcmOutcome(400, { error: { details: [{ errorCode: 'INVALID_ARGUMENT' }] } })).toBe('failed');
    expect(fcmOutcome(500, { error: { details: 'oops' } })).toBe('failed');
    expect(fcmOutcome(401, 'nope')).toBe('failed');
    expect(fcmOutcome(429, undefined)).toBe('failed');
  });
});

type Call = { url: string; init: RequestInit };

function stubFetch(handler: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const stub = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(url), init: init ?? {} };
    calls.push(call);
    return handler(call);
  });
  vi.stubGlobal('fetch', stub);
  return calls;
}

const tokenReply = (token = 'access-1', expiresIn = 3600) => Response.json({ access_token: token, expires_in: expiresIn });
const isTokenCall = (call: Call) => call.url === 'https://oauth2.googleapis.com/token';

beforeEach(() => {
  resetFcmCache();
  vi.stubEnv('FCM_SERVICE_ACCOUNT', ENV.FCM_SERVICE_ACCOUNT);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('sendFcm', () => {
  it('signs an RS256 assertion, then posts the message with the access token', async () => {
    const calls = stubFetch((call) => (isTokenCall(call) ? tokenReply() : Response.json({ name: 'projects/orbis-test/messages/1' })));
    expect(await sendFcm('device-token', PAYLOAD)).toBe('sent');
    expect(calls).toHaveLength(2);

    const form = new URLSearchParams(String(calls[0].init.body));
    expect(form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    const [header, claims, signature] = form.get('assertion')!.split('.');
    expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(JSON.parse(Buffer.from(claims, 'base64url').toString()).iss).toBe(ACCOUNT.client_email);
    const verify = createVerify('RSA-SHA256').update(`${header}.${claims}`);
    expect(verify.verify(publicKey, Buffer.from(signature, 'base64url'))).toBe(true);

    expect(calls[1].url).toBe('https://fcm.googleapis.com/v1/projects/orbis-test/messages:send');
    expect((calls[1].init.headers as Record<string, string>).authorization).toBe('Bearer access-1');
    expect(JSON.parse(String(calls[1].init.body))).toEqual(fcmMessage('device-token', PAYLOAD));
  });

  it('shares one token fetch between concurrent sends and reuses it afterwards', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const calls = stubFetch(async (call) => {
      if (isTokenCall(call)) {
        await gate;
        return tokenReply();
      }
      return Response.json({});
    });
    const sends = Promise.all(Array.from({ length: 6 }, (_, i) => sendFcm(`t${i}`, PAYLOAD)));
    release();
    expect(await sends).toEqual(Array(6).fill('sent'));
    expect(calls.filter(isTokenCall)).toHaveLength(1);

    await sendFcm('later', PAYLOAD);
    expect(calls.filter(isTokenCall)).toHaveLength(1);
  });

  it('fetches a new token once the cached one is within a minute of expiring', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-13T00:00:00Z'));
    const calls = stubFetch((call) => (isTokenCall(call) ? tokenReply('t', 3600) : Response.json({})));
    await sendFcm('a', PAYLOAD);
    vi.setSystemTime(new Date('2026-11-13T00:58:00Z'));
    await sendFcm('b', PAYLOAD);
    expect(calls.filter(isTokenCall)).toHaveLength(1);
    vi.setSystemTime(new Date('2026-11-13T00:59:30Z'));
    await sendFcm('c', PAYLOAD);
    expect(calls.filter(isTokenCall)).toHaveLength(2);
  });

  it('reports gone for an unregistered token and failed for other answers', async () => {
    stubFetch((call) => (isTokenCall(call) ? tokenReply() : Response.json({ error: { details: [{ errorCode: 'UNREGISTERED' }] } }, { status: 404 })));
    expect(await sendFcm('x', PAYLOAD)).toBe('gone');
    stubFetch((call) => (isTokenCall(call) ? tokenReply() : new Response('boom', { status: 503 })));
    expect(await sendFcm('x', PAYLOAD)).toBe('failed');
  });

  it('forgets the access token when FCM rejects it, so the next send signs in again', async () => {
    let rejected = false;
    const calls = stubFetch((call) => {
      if (isTokenCall(call)) return tokenReply();
      if (!rejected) {
        rejected = true;
        return new Response('{}', { status: 401 });
      }
      return Response.json({});
    });
    expect(await sendFcm('x', PAYLOAD)).toBe('failed');
    expect(await sendFcm('x', PAYLOAD)).toBe('sent');
    expect(calls.filter(isTokenCall)).toHaveLength(2);
  });

  it('never throws: an unconfigured, failing or garbled network gives failed', async () => {
    vi.stubEnv('FCM_SERVICE_ACCOUNT', '');
    expect(await sendFcm('x', PAYLOAD)).toBe('failed');

    vi.stubEnv('FCM_SERVICE_ACCOUNT', ENV.FCM_SERVICE_ACCOUNT);
    stubFetch(() => {
      throw new Error('offline');
    });
    expect(await sendFcm('x', PAYLOAD)).toBe('failed');

    resetFcmCache();
    stubFetch(() => new Response('not json', { status: 200 }));
    expect(await sendFcm('x', PAYLOAD)).toBe('failed');
  });

  it('puts a deadline on both requests', async () => {
    const calls = stubFetch((call) => (isTokenCall(call) ? tokenReply() : Response.json({})));
    await sendFcm('x', PAYLOAD);
    for (const call of calls) expect(call.init.signal).toBeInstanceOf(AbortSignal);
  });
});

// A stand-in for the admin client: just enough of the query builder for pushToUser.
type Row = Record<string, unknown>;
type Query = { table: string; mode: 'select' | 'update'; values: Row; filters: [string, ...unknown[]][] };
function fakeAdmin(options: { phones?: Row[]; phonesError?: boolean } = {}) {
  const queries: Query[] = [];
  const admin = {
    from(table: string) {
      const query: Query = { table, mode: 'select', values: {}, filters: [] };
      queries.push(query);
      const builder = {
        select() {
          return builder;
        },
        update(values: Row) {
          query.mode = 'update';
          query.values = values;
          return builder;
        },
        eq(column: string, value: unknown) {
          query.filters.push(['eq', column, value]);
          return builder;
        },
        not(column: string, op: string, value: unknown) {
          query.filters.push(['not', column, op, value]);
          return builder;
        },
        is(column: string, value: unknown) {
          query.filters.push(['is', column, value]);
          return builder;
        },
        then(resolve: (result: unknown) => void) {
          if (query.mode === 'update') resolve({ error: null });
          else if (table === 'devices') resolve(options.phonesError ? { data: null, error: { message: 'down' } } : { data: options.phones ?? [], error: null });
          else resolve({ data: [], error: null });
        },
      };
      return builder;
    },
  };
  return { admin: admin as never, queries, updates: () => queries.filter((query) => query.mode === 'update') };
}

describe('pushToUser with FCM', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY', '');
    vi.stubEnv('VAPID_PRIVATE_KEY', '');
  });

  it('sends to each phone token and counts them in devices and sent', async () => {
    const calls = stubFetch((call) => (isTokenCall(call) ? tokenReply() : Response.json({})));
    const { admin, queries } = fakeAdmin({ phones: [{ id: 'd1', push_token: 'tok-1' }, { id: 'd2', push_token: 'tok-2' }] });
    expect(await pushToUser(admin, 'user-1', PAYLOAD)).toEqual({ sent: 2, failed: 0, devices: 2, error: null });
    expect(queries.map((query) => query.table)).toEqual(['devices']);
    expect(calls.filter((call) => !isTokenCall(call))).toHaveLength(2);
  });

  it("asks only for this person's live phones that hold a token", async () => {
    stubFetch(() => tokenReply());
    const { admin, queries } = fakeAdmin({ phones: [] });
    await pushToUser(admin, 'user-1', PAYLOAD);
    expect(queries[0].filters).toEqual([
      ['eq', 'user_id', 'user-1'],
      ['not', 'push_token', 'is', null],
      ['is', 'revoked_at', null],
    ]);
  });

  it('clears the token of a phone FCM reports gone, and counts it failed', async () => {
    stubFetch((call) => (isTokenCall(call) ? tokenReply() : Response.json({ error: { details: [{ errorCode: 'UNREGISTERED' }] } }, { status: 404 })));
    const { admin, updates } = fakeAdmin({ phones: [{ id: 'd1', push_token: 'old' }] });
    expect(await pushToUser(admin, 'user-1', PAYLOAD)).toEqual({ sent: 0, failed: 1, devices: 1, error: null });
    expect(updates()).toEqual([
      {
        table: 'devices',
        mode: 'update',
        values: { push_token: null },
        filters: [['eq', 'id', 'd1'], ['eq', 'user_id', 'user-1'], ['eq', 'push_token', 'old']],
      },
    ]);
  });

  it('keeps the token on a bare 404, which a wrong project id also produces', async () => {
    stubFetch((call) => (isTokenCall(call) ? tokenReply() : new Response('{}', { status: 404 })));
    const { admin, updates } = fakeAdmin({ phones: [{ id: 'd1', push_token: 'tok' }] });
    expect(await pushToUser(admin, 'user-1', PAYLOAD)).toEqual({ sent: 0, failed: 1, devices: 1, error: null });
    expect(updates()).toEqual([]);
  });

  it('keeps the token when the failure is not a gone token', async () => {
    stubFetch((call) => (isTokenCall(call) ? tokenReply() : new Response('{}', { status: 500 })));
    const { admin, updates } = fakeAdmin({ phones: [{ id: 'd1', push_token: 'tok' }] });
    expect(await pushToUser(admin, 'user-1', PAYLOAD)).toEqual({ sent: 0, failed: 1, devices: 1, error: null });
    expect(updates()).toEqual([]);
  });

  it('keeps at most four sends in flight', async () => {
    let active = 0;
    let peak = 0;
    stubFetch(async (call) => {
      if (isTokenCall(call)) return tokenReply();
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return Response.json({});
    });
    const phones = Array.from({ length: 10 }, (_, i) => ({ id: `d${i}`, push_token: `tok-${i}` }));
    const result = await pushToUser(fakeAdmin({ phones }).admin, 'user-1', PAYLOAD);
    expect(result.sent).toBe(10);
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1);
  });

  it('skips FCM silently when it is not configured, keeping the old error when nothing is', async () => {
    vi.stubEnv('FCM_SERVICE_ACCOUNT', '');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { admin, queries } = fakeAdmin({ phones: [{ id: 'd1', push_token: 'tok' }] });
    expect(await pushToUser(admin, 'user-1', PAYLOAD)).toEqual({ sent: 0, failed: 0, devices: 0, error: 'Push keys are not configured on the server.' });
    expect(queries).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not throw on a malformed service account', async () => {
    vi.stubEnv('FCM_SERVICE_ACCOUNT', encode({ ...ACCOUNT, private_key: 'garbage' }));
    const { admin } = fakeAdmin({ phones: [{ id: 'd1', push_token: 'tok' }] });
    expect(await pushToUser(admin, 'user-1', PAYLOAD)).toMatchObject({ sent: 0, devices: 0, error: 'Push keys are not configured on the server.' });
  });

  it('reports a load error when phones cannot be read and web push is off', async () => {
    const { admin } = fakeAdmin({ phonesError: true });
    expect(await pushToUser(admin, 'user-1', PAYLOAD)).toEqual({ sent: 0, failed: 0, devices: 0, error: 'Registered phones could not be loaded.' });
  });
});
