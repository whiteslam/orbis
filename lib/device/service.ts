// What the phone endpoints do once a request has been read, with every
// outside dependency passed in so it can be tested without a database or a key.
// Nothing here logs signal content, a secret or an error message: a Postgres
// or crypto message can carry a value, so only the error's name and code do.

import { deviceCredential, parseSync, type Source } from './http';

export type SyncResult = { accepted: number; duplicate: number; refused: number };

/** Exactly the keys device_sync reads from its four jsonb arguments. */
export type SyncArgs = {
  deviceId: string;
  secret: string;
  meta: { appVersion?: string; pushToken?: string };
  sources: { source: Source; enabled: boolean }[];
  signals: { id: string; source: Source; kind: string; occurredAt: string; content: string }[];
  ledger: { day: string; source: Source; kept: number; dropped: number; actions: number }[];
};

export type SyncDeps = {
  whoami(id: string, secret: string): Promise<string | null>;
  sync(args: SyncArgs): Promise<SyncResult | null>;
  ready(): boolean;
  encrypt(userId: string, text: string, context: string): string;
};

type Outcome = { status: number; body: unknown };

const NOT_SIGNED_IN = { error: 'This phone is not signed in to Orbis.' };
const NOT_READY = { error: 'Phone sync is not set up on the server yet.' };
const FAILED = { error: 'Phone sync failed on the server. Try again later.' };

function logFailure(what: string, error: unknown) {
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  console.error(what, error instanceof Error ? error.name : typeof error, typeof code === 'string' ? code : '');
}

export async function syncDevice(deps: SyncDeps, authHeader: string | null, body: string, now: Date): Promise<Outcome> {
  const credential = deviceCredential(authHeader);
  if (!credential) return { status: 401, body: NOT_SIGNED_IN };
  if (!deps.ready()) return { status: 503, body: NOT_READY };

  const input = parseSync(body, now);
  if (typeof input === 'string') return { status: 400, body: { error: input } };

  try {
    const userId = await deps.whoami(credential.deviceId, credential.secret);
    if (!userId) return { status: 401, body: NOT_SIGNED_IN };

    // Raw text leaves the request here as a per-user envelope bound to the
    // signal's id; the database only ever sees ciphertext.
    const signals = input.signals.map((signal) => ({ ...signal, content: deps.encrypt(userId, signal.content, signal.id) }));
    const result = await deps.sync({ ...credential, meta: input.meta, sources: input.sources, signals, ledger: input.ledger });
    if (!result) return { status: 401, body: NOT_SIGNED_IN };
    return { status: 200, body: result };
  } catch (error) {
    logFailure('Device sync failed', error);
    return { status: 500, body: FAILED };
  }
}

export async function revokeWithCredential(deps: { revoke(id: string, secret: string): Promise<boolean> }, authHeader: string | null): Promise<{ status: number }> {
  const credential = deviceCredential(authHeader);
  if (!credential) return { status: 401 };
  try {
    return { status: (await deps.revoke(credential.deviceId, credential.secret)) ? 204 : 401 };
  } catch (error) {
    logFailure('Device revoke failed', error);
    return { status: 500 };
  }
}

/**
 * The request body as text, or null when it is longer than `maxBytes`. The
 * declared Content-Length is checked first, but a missing or false one doesn't
 * help: the stream is counted as it arrives and cancelled the moment it passes
 * the cap, so an oversized body is never buffered whole.
 */
export async function readBodyCapped(request: Request, maxBytes: number): Promise<string | null> {
  const declared = request.headers.get('content-length');
  if (declared !== null && /^\d+$/.test(declared.trim()) && Number(declared) > maxBytes) return null;
  if (!request.body) return '';

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}
