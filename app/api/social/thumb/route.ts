import { type NextRequest } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/auth/session';
import { isMetaCdnUrl, thumbnailType } from '@/lib/social/insights-shape';

/**
 * A post thumbnail from Instagram or Threads, served from Orbis's own origin.
 *
 * Meta's CDN answers with Cross-Origin-Resource-Policy: same-origin, so a
 * browser refuses to show its images on any other site and every thumbnail in
 * Social insights came out broken. Fetching it here and handing it on as our
 * own response is the only way to show it.
 *
 * It is not an open proxy: signed-in users only, https on Meta's CDN hosts only,
 * every redirect hop checked again, raster images only, and a size cap.
 */
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_HOPS = 3;

const refuse = (status: number) => new Response(null, { status, headers: { 'cache-control': 'no-store' } });

/** One request to the CDN, without following redirects; null when it fails or times out. */
async function fetchOnce(url: string): Promise<Response | null> {
  try {
    return await fetch(url, { redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(10_000), headers: { accept: 'image/*' } });
  } catch {
    return null;
  }
}

/** Hands a final (non-redirect) CDN answer on as our own, or refuses it. */
async function passOnImage(response: Response): Promise<Response> {
  // Signed CDN links expire; the Refresh button fetches fresh ones.
  if (!response.ok) return refuse(response.status === 403 || response.status === 404 ? 410 : 502);
  const type = thumbnailType(response.headers.get('content-type'));
  if (!type) return refuse(415);
  if (Number(response.headers.get('content-length') ?? 0) > MAX_BYTES) return refuse(413);
  const body = await response.arrayBuffer();
  if (body.byteLength > MAX_BYTES) return refuse(413);

  return new Response(body, {
    headers: {
      'content-type': type,
      // Private: the URL is the user's own signed CDN link.
      'cache-control': 'private, max-age=3600',
      'x-content-type-options': 'nosniff',
    },
  });
}

export async function GET(request: NextRequest) {
  if (!(await getAuthenticatedUserId())) return refuse(401);

  let url = request.nextUrl.searchParams.get('u');
  if (!isMetaCdnUrl(url)) return refuse(400);

  for (let hop = 0; hop <= MAX_HOPS; hop += 1) {
    const response = await fetchOnce(url!); // NOSONAR: each redirect hop needs the previous hop's Location
    if (!response) return refuse(504);
    if (response.status < 300 || response.status >= 400) return passOnImage(response);

    const next = response.headers.get('location');
    url = next ? new URL(next, url!).toString() : null;
    if (!isMetaCdnUrl(url)) return refuse(502);
  }
  return refuse(508);
}
