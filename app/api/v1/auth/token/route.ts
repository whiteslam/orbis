import { apiError, sessionlessClient } from '@/lib/api/gate';
import { readCredentials } from '@/lib/api/http';
import { admittedEmail, tokenRequest, tokenResponse } from '@/lib/api/sign-in';

// POST /api/v1/auth/token  {"email": "...", "password": "..."}
// Signs in as in the app and hands back the session's tokens instead of setting a cookie.
export async function POST(request: Request) {
  const checked = await tokenRequest(request);
  if ('refuse' in checked) return checked.refuse;
  const credentials = readCredentials(checked.text);
  if (typeof credentials === 'string') return apiError(400, credentials);

  // Checked before the password is, as in the app, so an unlisted address can't learn whether it has an account.
  const denied = admittedEmail(credentials.email);
  if (denied) return denied;

  const { data, error } = await sessionlessClient().auth.signInWithPassword(credentials);
  // One answer for a wrong password and an unconfirmed account, as in the app.
  if (error?.code === 'invalid_credentials' || error?.code === 'email_not_confirmed') {
    return apiError(401, 'That email and password didn’t work. If you just created your account, confirm it from the email we sent first.');
  }
  if (error?.status === 429) return apiError(429, 'Too many sign-in attempts. Wait a few minutes, then try again.');
  if (error || !data.session) return apiError(503, 'Sign-in is temporarily unavailable. Please try again shortly.');
  return tokenResponse(data.session);
}
