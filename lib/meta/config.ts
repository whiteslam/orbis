import 'server-only';

import { META_PLATFORMS, type MetaPlatform } from '@/lib/meta/types';

const ENV: Record<MetaPlatform, { id: string; secret: string }> = {
  instagram: { id: 'INSTAGRAM_APP_ID', secret: 'INSTAGRAM_APP_SECRET' },
  threads: { id: 'THREADS_APP_ID', secret: 'THREADS_APP_SECRET' },
};

export function isMetaPlatform(value: unknown): value is MetaPlatform {
  return typeof value === 'string' && (META_PLATFORMS as string[]).includes(value);
}

export function metaCredentials(platform: MetaPlatform) {
  const clientId = process.env[ENV[platform].id]?.trim();
  const clientSecret = process.env[ENV[platform].secret]?.trim();
  if (!clientId || !/^\d{5,32}$/.test(clientId) || !clientSecret) return null;
  return { clientId, clientSecret };
}

export function metaConfigured(platform: MetaPlatform) {
  return metaCredentials(platform) !== null;
}

/** Built from the request's own origin, so local and production each use their registered URL. */
export function redirectUri(platform: MetaPlatform, origin: string) {
  return `${origin}/auth/meta/${platform}/callback`;
}

/** The httpOnly cookie holding the signed OAuth state, scoped to this platform's routes. */
export const metaStateCookie = (platform: MetaPlatform) => `orbis-meta-${platform}-state`;
