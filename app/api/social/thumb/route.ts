import { type NextRequest } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/auth/session';
import { isMetaCdnUrl } from '@/lib/social/insights-shape';

/**
 * A post thumbnail from Instagram or Threads, served from Orbis's own origin.
 *
 * Meta's CDN answers with Cross-Origin-Resource-Policy: same-origin, so a
 * browser refuses to show its images on any other site and every thumbnail in
 * Social insights came out broken. Fetching it here and handing it on as our
 * own response is the only way to show it.
 *
 * It is not an open proxy: signed-in users only, https on Meta's CDN hosts only,
 * every redirect hop checked again, images only, and a size cap.
 */
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_HOPS = 3;

const refuse = (status: number) => new Response(null, { status, headers: { 'cache-control': 'no-store' } });

export async function GET(request: NextRequest) {
  if (!(await getAuthenticatedUserId())) return refuse(401);

  let url = request.nextUrl.searchParams.get('u');
  if (!isMetaCdnUrl(url)) return refuse(400);

  for (let hop = 0; hop <= MAX_HOPS; hop += 1) {
    let response: Response;
    try {
      response = await fetch(url!, { redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(10_000), headers: { accept: 'image/*' } });
    } catch {
      return refuse(504);
    }

    if (response.status >= 300 && response.status < 400) {
      const next = response.headers.get('location');
      url = next ? new URL(next, url!).toString() : null;
      if (!isMetaCdnUrl(url)) return refuse(502);
      continue;
    }

    // Signed CDN links expire; the Refresh button fetches fresh ones.
    if (!response.ok) return refuse(response.status === 403 || response.status === 404 ? 410 : 502);
    const type = response.headers.get('content-type') ?? '';
    if (!type.startsWith('image/')) return refuse(415);
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
  return refuse(508);
}
