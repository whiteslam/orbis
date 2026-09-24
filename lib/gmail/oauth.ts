import 'server-only';

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { isAppUnlocked } from '@/lib/security/app-lock';
import { encryptRefreshToken } from '@/lib/gmail/crypto';
import { getGmailConfig } from '@/lib/gmail/config';

export const gmailStateCookieName = 'orbis-gmail-oauth-state';

export type GoogleTokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type: string;
};

export class GoogleOAuthError extends Error {
  constructor(message: string, readonly reconnectRequired = false) {
    super(message);
    this.name = 'GoogleOAuthError';
  }
}

export async function getAuthenticatedUserId() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;

  if (error || typeof userId !== 'string') {
    return null;
  }

  // A locked Orbis behaves as signed out for data access until the user unlocks.
  if (!(await isAppUnlocked(data?.claims))) return null;

  return userId;
}

function signState(state: string, userId: string) {
  const { clientSecret } = getGmailConfig();
  return createHmac('sha256', clientSecret).update(`${state}.${userId}`).digest('base64url');
}

export function createSignedGmailState(userId: string) {
  const state = randomBytes(32).toString('base64url');
  return { state, cookieValue: `${state}.${userId}.${signState(state, userId)}` };
}

export function verifySignedGmailState(cookieValue: string | undefined, returnedState: string | null) {
  if (!cookieValue || !returnedState) return null;
  const parts = cookieValue.split('.');
  if (parts.length !== 3) return null;

  const [state, userId, signature] = parts;
  if (!state || state !== returnedState || !userId || !signature) return null;

  let expected: string;
  try {
    expected = signState(state, userId);
  } catch {
    return null;
  }

  const providedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (providedBuffer.length !== expectedBuffer.length || !timingSafeEqual(providedBuffer, expectedBuffer)) {
    return null;
  }

  return userId;
}

export function buildGoogleAuthorizationUrl(state: string) {
  const { clientId, redirectUri } = getGmailConfig();
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email https://www.googleapis.com/auth/gmail.readonly');
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('include_granted_scopes', 'true');
  url.searchParams.set('state', state);
  return url.toString();
}

async function postGoogleToken(form: URLSearchParams): Promise<GoogleTokenResponse> {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form,
    cache: 'no-store',
  });

  const payload = (await response.json().catch(() => ({}))) as Partial<GoogleTokenResponse> & { error?: string };
  if (!response.ok) {
    if (payload.error === 'invalid_grant') {
      throw new GoogleOAuthError('Gmail access needs to be reconnected.', true);
    }
    throw new GoogleOAuthError('Google could not complete the Gmail authorization. Please try again.');
  }

  if (typeof payload.access_token !== 'string' || typeof payload.expires_in !== 'number') {
    throw new GoogleOAuthError('Google returned an incomplete authorization response. Please try again.');
  }

  return payload as GoogleTokenResponse;
}

export async function exchangeGoogleCode(code: string) {
  const { clientId, clientSecret, redirectUri } = getGmailConfig();
  const form = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });
  return postGoogleToken(form);
}

export async function refreshGoogleAccessToken(refreshToken: string) {
  const { clientId, clientSecret } = getGmailConfig();
  const form = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
  });
  return postGoogleToken(form);
}

export async function getGoogleAccount(accessToken: string) {
  const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  });

  if (!response.ok) throw new GoogleOAuthError('Google could not verify the connected account. Please try again.');

  const profile = (await response.json()) as { sub?: unknown; email?: unknown; email_verified?: unknown };
  if (typeof profile.sub !== 'string' || typeof profile.email !== 'string' || profile.email_verified !== true) {
    throw new GoogleOAuthError('Google did not return a verified email address for this account.');
  }

  return { sub: profile.sub, email: profile.email };
}

export async function saveGmailConnection(userId: string, account: { sub: string; email: string }, refreshToken?: string) {
  const admin = createAdminClient();
  const { data: existing, error: readError } = await admin
    .from('gmail_connections')
    .select('id, google_user_id, refresh_token_encrypted')
    .eq('user_id', userId)
    .maybeSingle();

  if (readError) throw new Error('Gmail connection could not be saved. Apply the finance database migration and try again.');

  let encryptedRefreshToken: string;
  if (refreshToken) {
    encryptedRefreshToken = encryptRefreshToken(refreshToken);
  } else if (existing?.google_user_id === account.sub && typeof existing.refresh_token_encrypted === 'string') {
    encryptedRefreshToken = existing.refresh_token_encrypted;
  } else {
    throw new GoogleOAuthError('Google did not provide offline access. Reconnect Gmail and approve access again.', true);
  }

  if (existing && existing.google_user_id !== account.sub) {
    throw new GoogleOAuthError('Disconnect the currently connected Gmail account before connecting a different one.');
  }

  const values = {
    user_id: userId,
    google_email: account.email,
    google_user_id: account.sub,
    refresh_token_encrypted: encryptedRefreshToken,
    status: 'connected',
    updated_at: new Date().toISOString(),
  };

  const { error } = await admin.from('gmail_connections').upsert(values, { onConflict: 'user_id' });

  if (error) throw new Error('Gmail connection could not be saved. Apply the finance database migration and try again.');
}

export async function revokeGoogleToken(token: string) {
  const response = await fetch('https://oauth2.googleapis.com/revoke', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token }),
    cache: 'no-store',
  });
  return response.ok || response.status === 400;
}
