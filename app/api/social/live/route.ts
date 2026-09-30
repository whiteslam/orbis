import { homeRequester, NO_STORE } from '@/lib/home/route-auth';
import { loadLive } from '@/lib/meta/live';
import { PERIOD_PATTERN } from '@/lib/social/month';

// GET /api/social/live?period=2026-09-01 → Instagram and Threads posts, stats and new auto-marks for that month.
export async function GET(request: Request) {
  const requester = await homeRequester();
  if (!requester) return Response.json(null, { status: 401, headers: NO_STORE });
  const period = new URL(request.url).searchParams.get('period') ?? '';
  if (!PERIOD_PATTERN.test(period)) return Response.json(null, { status: 400, headers: NO_STORE });
  try {
    return Response.json(await loadLive(requester.userId, period), { headers: NO_STORE });
  } catch (error) {
    console.error('Social live failed', error instanceof Error ? error.message : 'unknown');
    return Response.json({ platforms: [] }, { headers: NO_STORE });
  }
}
