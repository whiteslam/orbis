import 'server-only';

import { timingSafeEqual } from 'node:crypto';

/**
 * Whether a cron request carries `Authorization: Bearer <CRON_SECRET>`,
 * compared in constant time. A missing or short secret refuses everything, so
 * a misconfigured deployment fails closed. Shared by every pg_cron route.
 */
export function cronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || secret.length < 32) return false;
  const provided = Buffer.from(request.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${secret}`);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}
