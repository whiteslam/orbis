import 'server-only';

import { createPrivateKey, createSign } from 'node:crypto';
import type { PushPayload } from '@/lib/notifications/push';

// Native push to Orbis phones through Firebase Cloud Messaging (HTTP v1). It is
// optional: with FCM_SERVICE_ACCOUNT unset or unusable, `fcmConfigured` is false
// and nothing here is called. Nothing in this file logs a token, the service
// account, its private key or an access token.

export type FcmOutcome = 'sent' | 'gone' | 'failed';

type ServiceAccount = { project_id: string; client_email: string; private_key: string };

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
// Same bound as web push: a hung Google endpoint must not hold the scheduler.
const FCM_TIMEOUT_MS = 5_000;
// Renew a minute early so a token never expires between signing in and sending.
const EXPIRY_MARGIN_MS = 60_000;

// The parsed service account, remembered per raw env value so each send does
// not decode and re-validate the key. A change of env value re-parses.
let parsed: { raw: string; account: ServiceAccount | null } | null = null;

function readAccount(env: Record<string, string | undefined>): ServiceAccount | null {
  const raw = env.FCM_SERVICE_ACCOUNT?.trim();
  if (!raw) return null;
  if (parsed?.raw === raw) return parsed.account;
  let account: ServiceAccount | null = null;
  try {
    const json = JSON.parse(Buffer.from(raw, 'base64').toString('utf8')) as Record<string, unknown>;
    const { project_id, client_email, private_key } = json;
    if (typeof project_id === 'string' && project_id && typeof client_email === 'string' && client_email && typeof private_key === 'string' && private_key) {
      createPrivateKey(private_key); // throws on anything that is not a usable key
      account = { project_id, client_email, private_key };
    }
  } catch {
    account = null;
  }
  parsed = { raw, account };
  return account;
}

export function fcmConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return readAccount(env) !== null;
}

export function fcmJwtClaims(sa: { client_email: string }, nowSec: number) {
  return { iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL, iat: nowSec, exp: nowSec + 3600 };
}

export function fcmMessage(token: string, payload: PushPayload) {
  return {
    message: {
      token,
      notification: { title: payload.title, body: payload.body },
      android: { priority: 'high', notification: { channel_id: 'orbis', tag: payload.tag } },
      data: { url: payload.url },
    },
  };
}

/** 200 is sent. An UNREGISTERED error code, at any status, means the phone's token is dead. A bare 404 is not enough: a wrong project id also answers 404 and must not wipe tokens. */
export function fcmOutcome(status: number, body: unknown): FcmOutcome {
  if (status === 200) return 'sent';
  const details = (body as { error?: { details?: unknown } } | null | undefined)?.error?.details;
  if (Array.isArray(details) && details.some((detail) => (detail as { errorCode?: unknown } | null)?.errorCode === 'UNREGISTERED')) return 'gone';
  return 'failed';
}

// The access token is shared by every send in this process. `inflight` makes
// concurrent callers wait on one sign-in instead of each starting their own.
let cached: { token: string; expiresAt: number } | null = null;
let inflight: Promise<string | null> | null = null;

/** Forgets the cached access token and any sign-in in progress. For tests. */
export function resetFcmCache() {
  cached = null;
  inflight = null;
  parsed = null;
}

const b64url = (value: string | Buffer) => Buffer.from(value).toString('base64url');

async function signIn(account: ServiceAccount): Promise<string | null> {
  try {
    const signingInput = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify(fcmJwtClaims(account, Math.floor(Date.now() / 1000))))}`;
    const signature = createSign('RSA-SHA256').update(signingInput).sign(account.private_key);
    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${signingInput}.${b64url(signature)}` }),
      signal: AbortSignal.timeout(FCM_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { access_token?: unknown; expires_in?: unknown };
    if (typeof body.access_token !== 'string' || !body.access_token) return null;
    const seconds = typeof body.expires_in === 'number' && body.expires_in > 0 ? body.expires_in : 3600;
    cached = { token: body.access_token, expiresAt: Date.now() + seconds * 1000 - EXPIRY_MARGIN_MS };
    return body.access_token;
  } catch {
    return null;
  }
}

function accessToken(account: ServiceAccount): Promise<string | null> {
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.token);
  inflight ??= signIn(account).finally(() => {
    inflight = null;
  });
  return inflight;
}

/** Sends one notification to one phone token. Never throws. */
export async function sendFcm(token: string, payload: PushPayload): Promise<FcmOutcome> {
  try {
    const account = readAccount(process.env);
    if (!account) return 'failed';
    const access = await accessToken(account);
    if (!access) return 'failed';
    const response = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(account.project_id)}/messages:send`, {
      method: 'POST',
      headers: { authorization: `Bearer ${access}`, 'content-type': 'application/json' },
      body: JSON.stringify(fcmMessage(token, payload)),
      signal: AbortSignal.timeout(FCM_TIMEOUT_MS),
    });
    // Google refused the access token itself: drop it so the next send signs in again.
    if (response.status === 401 && cached?.token === access) cached = null;
    const body: unknown = await response.json().catch(() => null);
    return fcmOutcome(response.status, body);
  } catch {
    return 'failed';
  }
}
