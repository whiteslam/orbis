import { apiError, sessionlessClient } from '@/lib/api/gate';
import { readRefreshToken } from '@/lib/api/http';
import { admittedEmail, tokenRequest, tokenResponse } from '@/lib/api/sign-in';

// POST /api/v1/auth/refresh  {"refreshToken": "..."}
// Swaps a refresh token for a new pair. Each refresh token works once; keep the new one.
export async function POST(request: Request) {
  const checked = await tokenRequest(request);
  if ('refuse' in checked) return checked.refuse;
  const refreshToken = readRefreshToken(checked.text);
  if (!refreshToken) return apiError(400, 'Send {"refreshToken": "..."} from your last sign-in or refresh.');

  const { data, error } = await sessionlessClient().auth.refreshSession({ refresh_token: refreshToken });
  if (error?.status === 429) return apiError(429, 'Too many refreshes. Wait a few minutes, then try again.');
  if (error || !data.session) return apiError(401, 'That refresh token has expired or was already used. Sign in again with POST /api/v1/auth/token.');
  // An address taken off the allowlist since the last sign-in loses API access here too.
  const denied = admittedEmail(data.session.user.email);
  if (denied) return denied;
  return tokenResponse(data.session);
}
