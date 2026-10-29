// The /api/v1 request and response rules. Pure, so they can be unit tested.

/** A JSON body larger than this is refused before it is parsed. */
export const MAX_BODY_BYTES = 256 * 1024;
/** No action takes more than a few arguments; anything longer is a mistake or a probe. */
export const MAX_ARGS = 4;

export const NO_STORE = { 'cache-control': 'no-store' } as const;

/** The API is off until the server says otherwise, so deploying it changes nothing on its own. */
export function apiEnabled(env: Record<string, string | undefined> = process.env) {
  return env.ORBIS_API_ENABLED?.trim().toLowerCase() === 'true';
}

/** The token from `Authorization: Bearer <jwt>`, or null. Only a JWT-shaped value is accepted. */
export function bearerToken(header: string | null | undefined): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(header?.trim() ?? '');
  const token = match?.[1];
  if (!token || token.length > 4096) return null;
  return /^[\w-]+\.[\w-]+\.[\w-]+$/.test(token) ? token : null;
}

/** An action's arguments from `{ "args": [...] }`; no body, or no `args`, is none. A message when the body is wrong. */
export function readArgs(text: string): unknown[] | string {
  if (!text.trim()) return [];
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return 'The body must be JSON.';
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'The body must be a JSON object, like {"args": []}.';
  const { args } = body as { args?: unknown };
  if (args === undefined) return [];
  if (!Array.isArray(args)) return '"args" must be an array.';
  if (args.length > MAX_ARGS) return `"args" takes at most ${MAX_ARGS} values.`;
  return args;
}

/**
 * The HTTP status for what an action returned. The app's actions answer
 * `{ success: false, message }` or `{ error }` when they refuse; that is the
 * caller's request failing, so 422, with the action's own words in the body.
 */
export function actionStatus(result: unknown): 200 | 422 {
  if (!result || typeof result !== 'object') return 200;
  const { success, error } = result as { success?: unknown; error?: unknown };
  return success === false || (typeof error === 'string' && error.length > 0) ? 422 : 200;
}

/** `{ email, password }` from a sign-in body, or a message. */
export function readCredentials(text: string): { email: string; password: string } | string {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return 'The body must be JSON: {"email": "...", "password": "..."}.';
  }
  const { email, password } = (body ?? {}) as { email?: unknown; password?: unknown };
  if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) return 'Send your email and password.';
  if (email.length > 320 || password.length > 1024) return 'That email and password didn’t work.';
  return { email: email.trim().toLowerCase(), password };
}

/** `{ refreshToken }` from a refresh body, or null. */
export function readRefreshToken(text: string): string | null {
  try {
    const { refreshToken } = (JSON.parse(text) ?? {}) as { refreshToken?: unknown };
    return typeof refreshToken === 'string' && refreshToken.length > 0 && refreshToken.length <= 1024 ? refreshToken : null;
  } catch {
    return null;
  }
}
