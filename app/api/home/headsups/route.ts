import { getHeadsupPrefs, listHeadsups } from '@/lib/headsups/repository';
import { homeRequester, NO_STORE } from '@/lib/home/route-auth';

// GET /api/home/headsups → what Orbis noticed, for Today's card.
// GET /api/home/headsups?prefs=1 → only which checks are off, for Settings (marks nothing seen).
export async function GET(request: Request) {
  const requester = await homeRequester();
  if (!requester) return Response.json(null, { status: 401, headers: NO_STORE });
  try {
    const prefsOnly = new URL(request.url).searchParams.get('prefs') === '1';
    return Response.json(await (prefsOnly ? getHeadsupPrefs(requester.userId) : listHeadsups(requester.userId)), { headers: NO_STORE });
  } catch (error) {
    console.error('Home heads-ups failed', error);
    return Response.json(null, { status: 500, headers: NO_STORE });
  }
}
