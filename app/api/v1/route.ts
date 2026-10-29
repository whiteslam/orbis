import { API_ACTIONS } from '@/lib/api/actions';
import { API_DATA } from '@/lib/api/data';
import { API_OFF } from '@/lib/api/gate';
import { NO_STORE, apiEnabled } from '@/lib/api/http';

// GET /api/v1
// What the API offers. Needs no token: the names are the same as in the public source.
export function GET() {
  if (!apiEnabled()) return API_OFF();
  return Response.json({
    version: 1,
    docs: 'docs/api.md in the Orbis repository',
    auth: {
      signIn: 'POST /api/v1/auth/token {"email", "password"} → {"accessToken", "refreshToken", "expiresAt"}',
      refresh: 'POST /api/v1/auth/refresh {"refreshToken"}',
      use: 'Authorization: Bearer <accessToken>',
    },
    data: Object.keys(API_DATA).map((area) => `GET /api/v1/data/${area}`),
    actions: Object.keys(API_ACTIONS).map((name) => `POST /api/v1/actions/${name}`),
  }, { headers: NO_STORE });
}
