import { test } from 'vitest';
import assert from 'node:assert/strict';
import { askSession, CHUNK, rangeReader, REQUEST_TIMEOUT_MS, runUpload, type UploadIo, type UploadRow } from './upload.ts';

const CREATE_URL = 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status';
const SESSION = 'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=abc';

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown; size: number; redirect?: string; signal?: AbortSignal | null };
type Reply = (call: Call) => Response | Promise<Response>;

const row = (over: Partial<UploadRow> = {}): UploadRow => ({
  uploadUrl: null,
  bytesSent: 0,
  title: 'A tall tale',
  description: 'Once upon a time.',
  tags: ['story'],
  categoryId: '23',
  privacy: 'public',
  madeForKids: false,
  ...over,
});

const bytes = (size: number) => {
  const file = new Uint8Array(size);
  for (let i = 0; i < size; i++) file[i] = i % 251;
  return file;
};

const resume = (lastByte: number) => new Response(null, { status: 308, headers: lastByte >= 0 ? { range: `bytes=0-${lastByte}` } : {} });
const created = (id = 'vid123', privacy = 'public') => Response.json({ id, status: { privacyStatus: privacy } }, { status: 201 });

// A fake I/O over one in-memory file. Each YouTube request goes to `reply`, which sees what was sent.
function fakeIo(file: Uint8Array | null, reply: Reply, clock: () => number = () => 0) {
  const calls: Call[] = [];
  const reads: [number, number][] = [];
  const saves: { uploadUrl?: string | null; bytesSent?: number }[] = [];
  const io: UploadIo = {
    async readRange(start, end) {
      reads.push([start, end]);
      if (!file) return null;
      return { bytes: file.slice(start, end + 1), total: file.length };
    },
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const headers: Record<string, string> = {};
      new Headers(init?.headers).forEach((value, key) => { headers[key] = value; });
      const body = init?.body;
      const size = body instanceof Uint8Array ? body.length : 0;
      const call = { url: String(input), method: init?.method ?? 'GET', headers, body, size, redirect: init?.redirect, signal: init?.signal };
      calls.push(call);
      return reply(call);
    }) as typeof fetch,
    now: clock,
    async save(patch) { saves.push(patch); },
    // The deadlines in these tests are tiny numbers, so the time limit is too.
    timeoutMs: 1,
  };
  return { io, calls, reads, saves };
}

const session = () => new Response(null, { status: 200, headers: { location: SESSION } });

test('one run uploads a small file and returns done with the id and privacy', async () => {
  const file = bytes(1000);
  const { io, calls, saves } = fakeIo(file, (call) => (call.method === 'POST' ? session() : created('abc123', 'private')));
  const outcome = await runUpload(row(), 'token-1', 10, io);
  assert.deepEqual(outcome, { kind: 'done', youtubeId: 'abc123', privacy: 'private' });

  const [create, put] = calls;
  assert.equal(create.url, CREATE_URL);
  assert.equal(create.method, 'POST');
  assert.equal(create.headers.authorization, 'Bearer token-1');
  assert.equal(create.headers['content-type'], 'application/json; charset=UTF-8');
  assert.equal(create.headers['x-upload-content-type'], 'video/mp4');
  assert.equal(create.headers['x-upload-content-length'], '1000');
  assert.deepEqual(JSON.parse(create.body as string), {
    snippet: { title: 'A tall tale', description: 'Once upon a time.', tags: ['story'], categoryId: '23', defaultLanguage: 'en' },
    status: { privacyStatus: 'public', selfDeclaredMadeForKids: false, embeddable: true },
  });

  assert.equal(put.url, SESSION);
  assert.equal(put.method, 'PUT');
  assert.equal(put.headers['content-range'], 'bytes 0-999/1000');
  assert.equal(put.size, 1000);
  // A 308 is YouTube's "go on", not a redirect: fetch must hand it back, not follow it.
  assert.equal(put.redirect, 'manual');
  assert.deepEqual(saves[0], { uploadUrl: SESSION, bytesSent: 0 });
});

test('resumes from bytesSent with the right Content-Range', async () => {
  const file = bytes(CHUNK + 500);
  const { io, calls } = fakeIo(file, (call) => {
    // The status query first: YouTube says it has the first chunk.
    if (call.headers['content-range'] === `bytes */${CHUNK + 500}`) return resume(CHUNK - 1);
    return created();
  });
  const outcome = await runUpload(row({ uploadUrl: SESSION, bytesSent: CHUNK }), 'token', 10, io);
  assert.equal(outcome.kind, 'done');
  assert.ok(!calls.some((call) => call.method === 'POST'), 'no new session');
  const chunk = calls.at(-1)!;
  assert.equal(chunk.headers['content-range'], `bytes ${CHUNK}-${CHUNK + 499}/${CHUNK + 500}`);
  assert.equal(chunk.size, 500);
  assert.deepEqual(chunk.body, file.slice(CHUNK));
});

test('a resumed run trusts YouTube over a stale bytesSent', async () => {
  const file = bytes(CHUNK * 2 + 10);
  const { io, calls, saves } = fakeIo(file, (call) => {
    if (call.size === 0) return resume(CHUNK - 1);
    return created();
  });
  // The row says nothing was sent, but a slice was cut off after YouTube took the first chunk.
  const outcome = await runUpload(row({ uploadUrl: SESSION, bytesSent: 0 }), 'token', 10, io);
  assert.equal(outcome.kind, 'done');
  assert.equal(calls[1].headers['content-range'], `bytes ${CHUNK}-${CHUNK * 2 - 1}/${CHUNK * 2 + 10}`);
  assert.deepEqual(saves[0], { bytesSent: CHUNK });
});

test('stops with partial when the deadline passes and saves bytesSent', async () => {
  const file = bytes(CHUNK * 3);
  let time = 0;
  const { io, calls, saves } = fakeIo(file, (call) => {
    if (call.method === 'POST') return session();
    time += 30; // each chunk takes a while
    const end = Number(/bytes \d+-(\d+)\//.exec(call.headers['content-range'])![1]);
    return resume(end);
  }, () => time);
  const outcome = await runUpload(row(), 'token', 50, io);
  assert.deepEqual(outcome, { kind: 'partial' });
  assert.equal(calls.filter((call) => call.method === 'PUT').length, 2);
  assert.deepEqual(saves.at(-1), { bytesSent: CHUNK * 2 });
});

test('a file of exactly 16 MB sends two chunks, the last ending at 16777215/16777216', async () => {
  const file = bytes(16 * 1024 * 1024);
  const { io, calls } = fakeIo(file, (call) => {
    if (call.method === 'POST') return session();
    return call.headers['content-range'].startsWith('bytes 0-') ? resume(CHUNK - 1) : created();
  });
  const outcome = await runUpload(row(), 'token', 10, io);
  assert.equal(outcome.kind, 'done');
  const puts = calls.filter((call) => call.method === 'PUT');
  assert.deepEqual(puts.map((call) => call.headers['content-range']), ['bytes 0-8388607/16777216', 'bytes 8388608-16777215/16777216']);
  assert.deepEqual(puts.map((call) => call.size), [CHUNK, CHUNK]);
});

test('a 0-byte or missing object is missing without calling YouTube', async () => {
  for (const file of [new Uint8Array(0), null]) {
    const { io, calls } = fakeIo(file, () => created());
    assert.deepEqual(await runUpload(row(), 'token', 10, io), { kind: 'missing' });
    assert.equal(calls.length, 0);
  }
});

test('session 404 clears the url and returns restart', async () => {
  for (const status of [404, 410]) {
    const { io, saves } = fakeIo(bytes(100), () => new Response('gone', { status }));
    assert.deepEqual(await runUpload(row({ uploadUrl: SESSION, bytesSent: 0 }), 'token', 10, io), { kind: 'restart' });
    assert.deepEqual(saves.at(-1), { uploadUrl: null, bytesSent: 0 });
  }
});

const youtubeError = (status: number, reason: string, message = 'nope') =>
  Response.json({ error: { code: status, message, errors: [{ reason, message }] } }, { status });

test('403 quotaExceeded returns quota', async () => {
  for (const reason of ['quotaExceeded', 'uploadLimitExceeded']) {
    const { io } = fakeIo(bytes(100), () => youtubeError(403, reason));
    assert.deepEqual(await runUpload(row(), 'token', 10, io), { kind: 'quota' });
  }
  // Any other 403 is an ordinary error.
  const { io } = fakeIo(bytes(100), () => youtubeError(403, 'forbidden', 'Not allowed'));
  assert.deepEqual(await runUpload(row(), 'token', 10, io), { kind: 'error', message: 'YouTube said 403: Not allowed' });
});

test('401 returns reconnect', async () => {
  const { io } = fakeIo(bytes(100), () => youtubeError(401, 'authError'));
  assert.deepEqual(await runUpload(row(), 'token', 10, io), { kind: 'reconnect' });
  const later = fakeIo(bytes(100), (call) => (call.method === 'POST' ? session() : youtubeError(401, 'authError')));
  assert.deepEqual(await runUpload(row(), 'token', 10, later.io), { kind: 'reconnect' });
});

test('500 returns error with the message cut to 500', async () => {
  const { io } = fakeIo(bytes(100), (call) => (call.method === 'POST' ? session() : youtubeError(500, 'backendError', 'x'.repeat(900))));
  const outcome = await runUpload(row(), 'token', 10, io);
  assert.equal(outcome.kind, 'error');
  const message = (outcome as { message: string }).message;
  assert.ok(message.startsWith('YouTube said 500: xxx'));
  assert.equal([...message].length, 500);
});

test('a network failure is an error, not a crash', async () => {
  const { io } = fakeIo(bytes(100), () => { throw new TypeError('fetch failed'); });
  const outcome = await runUpload(row(), 'token', 10, io);
  assert.equal(outcome.kind, 'error');
  assert.match((outcome as { message: string }).message, /fetch failed/);
});

test('308 without a Range header restarts from 0', async () => {
  const file = bytes(CHUNK + 10);
  let puts = 0;
  const { io, calls, saves } = fakeIo(file, (call) => {
    if (call.method === 'POST') return session();
    puts += 1;
    if (puts === 1) return resume(CHUNK - 1);
    if (puts === 2) return resume(-1); // YouTube lost everything
    return call.headers['content-range'].startsWith('bytes 0-') ? resume(CHUNK - 1) : created();
  });
  assert.equal((await runUpload(row(), 'token', 10, io)).kind, 'done');
  const ranges = calls.filter((call) => call.method === 'PUT').map((call) => call.headers['content-range']);
  assert.deepEqual(ranges, [`bytes 0-${CHUNK - 1}/${CHUNK + 10}`, `bytes ${CHUNK}-${CHUNK + 9}/${CHUNK + 10}`, `bytes 0-${CHUNK - 1}/${CHUNK + 10}`, `bytes ${CHUNK}-${CHUNK + 9}/${CHUNK + 10}`]);
  assert.ok(saves.some((save) => save.bytesSent === 0 && !('uploadUrl' in save)));
});

test('a chunk that reads short is never sent', async () => {
  const { io, calls } = fakeIo(bytes(1000), (call) => (call.method === 'POST' ? session() : created()));
  const read = io.readRange;
  io.readRange = async (start, end) => (start === 0 && end === 0 ? read(start, end) : { bytes: new Uint8Array(10), total: 1000 });
  const outcome = await runUpload(row(), 'token', 10, io);
  assert.equal(outcome.kind, 'error');
  assert.equal(calls.filter((call) => call.method === 'PUT').length, 0);
});

// The storage side: a signed URL read with a Range header.
const storage = (respond: (range: string | null) => Response) => {
  const seen: (string | null)[] = [];
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    const range = new Headers(init?.headers).get('range');
    seen.push(range);
    return respond(range);
  }) as unknown as typeof fetch;
  return { fetchImpl, seen };
};

test('rangeReader reads a 206 and takes the total from Content-Range', async () => {
  const { fetchImpl, seen } = storage(() => new Response(new Uint8Array([5, 6, 7]), { status: 206, headers: { 'content-range': 'bytes 10-12/9000' } }));
  const read = await rangeReader('https://storage/signed', fetchImpl)(10, 12);
  assert.deepEqual(read, { bytes: new Uint8Array([5, 6, 7]), total: 9000 });
  assert.deepEqual(seen, ['bytes=10-12']);
});

test('rangeReader slices a 200 from a server that ignored Range', async () => {
  const file = bytes(50);
  const { fetchImpl } = storage(() => new Response(file, { status: 200, headers: { 'content-length': '50' } }));
  const read = await rangeReader('https://storage/signed', fetchImpl)(10, 19);
  assert.deepEqual(read, { bytes: file.slice(10, 20), total: 50 });
});

test('rangeReader says missing only for a 404 or a 400 that says not found, and total 0 for an empty object', async () => {
  const notFound = [
    new Response('no', { status: 404 }),
    Response.json({ statusCode: '404', error: 'not_found', message: 'Object not found' }, { status: 400 }),
  ];
  for (const response of notFound) {
    const { fetchImpl } = storage(() => response);
    assert.equal(await rangeReader('u', fetchImpl)(0, 0), null);
  }
  const empty = storage(() => new Response(null, { status: 416, headers: { 'content-range': 'bytes */0' } }));
  assert.deepEqual(await rangeReader('u', empty.fetchImpl)(0, 0), { bytes: new Uint8Array(0), total: 0 });
});

test('rangeReader refuses a range other than the one it asked for', async () => {
  const { fetchImpl } = storage(() => new Response(new Uint8Array(3), { status: 206, headers: { 'content-range': 'bytes 0-2/9000' } }));
  await assert.rejects(rangeReader('u', fetchImpl)(10, 12));
});

test('rangeReader throws, rather than say missing, for any other failure', async () => {
  const others = [
    Response.json({ statusCode: '400', error: 'InvalidJWT', message: 'jwt expired' }, { status: 400 }),
    new Response('busy', { status: 500 }),
  ];
  for (const response of others) {
    const { fetchImpl } = storage(() => response);
    await assert.rejects(rangeReader('u', fetchImpl)(0, 0));
  }
});

// A fetch that only ever ends by being aborted.
const hanging = (_input: unknown, init?: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    if (!signal) return; // no limit: it would hang for ever
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });

test('every request has a time limit of at most 15 s', () => {
  assert.ok(REQUEST_TIMEOUT_MS <= 15_000);
});

test('a YouTube request that never answers is cut off and becomes an error', async () => {
  const { io, calls } = fakeIo(bytes(100), (call) => hanging(call.url, { signal: call.signal }));
  io.timeoutMs = 20;
  const outcome = await runUpload(row(), 'token', Date.now() + 60_000, { ...io, now: Date.now });
  assert.equal(outcome.kind, 'error');
  assert.match((outcome as { message: string }).message, /^Couldn’t reach YouTube: /);
  assert.ok(calls[0].signal, 'the request carried a signal');
});

test('a storage read that never answers is cut off', async () => {
  await assert.rejects(rangeReader('u', hanging as unknown as typeof fetch, 20)(0, 0));
});

test('no chunk starts within one request time limit of the deadline', async () => {
  const file = bytes(CHUNK * 3);
  let time = 0;
  const { io, calls } = fakeIo(file, (call) => {
    if (call.method === 'POST') return session();
    time += 6_000;
    const end = Number(/bytes \d+-(\d+)\//.exec(call.headers['content-range'])![1]);
    return resume(end);
  }, () => time);
  io.timeoutMs = 15_000;
  // After one chunk it is 6 s in: 6 + 15 passes the 20 s deadline, so no second chunk.
  assert.deepEqual(await runUpload(row(), 'token', 20_000, io), { kind: 'partial' });
  assert.equal(calls.filter((call) => call.method === 'PUT').length, 1);
  // And with too little time to begin with, nothing is sent at all.
  const late = fakeIo(file, () => session(), () => 10_000);
  late.io.timeoutMs = 15_000;
  assert.deepEqual(await runUpload(row(), 'token', 20_000, late.io), { kind: 'partial' });
  assert.equal(late.calls.length, 0);
});

// askSession: before a failed row goes back in the queue, its old session is
// asked whether YouTube already has the whole video.
test('askSession says done when YouTube answers 201 with an id', async () => {
  const { io, calls } = fakeIo(bytes(1000), () => created('abc', 'public'));
  assert.deepEqual(await askSession(SESSION, 'token', row({ uploadUrl: SESSION }), io), { kind: 'done', youtubeId: 'abc', privacy: 'public' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'PUT');
  assert.equal(calls[0].headers['content-range'], 'bytes */1000');
  assert.equal(calls[0].size, 0);
});

test('askSession says unfinished on 308, 404, 503, a thrown fetch, an answer without an id and a missing file', async () => {
  const unreachable: Reply = () => { throw new TypeError('fetch failed'); };
  const replies: Reply[] = [
    () => resume(499),
    () => new Response('gone', { status: 404 }),
    () => new Response('busy', { status: 503 }),
    unreachable,
    () => Response.json({}, { status: 200 }),
  ];
  for (const reply of replies) {
    const { io } = fakeIo(bytes(1000), reply);
    assert.deepEqual(await askSession(SESSION, 'token', row({ uploadUrl: SESSION }), io), { kind: 'unfinished' });
  }
  const { io, calls } = fakeIo(null, () => created());
  assert.deepEqual(await askSession(SESSION, 'token', row({ uploadUrl: SESSION }), io), { kind: 'unfinished' });
  assert.equal(calls.length, 0);
});
