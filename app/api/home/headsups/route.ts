import { listHeadsups } from '@/lib/headsups/repository';
import { homeRequester, NO_STORE } from '@/lib/home/route-auth';

// GET /api/home/headsups → what Orbis noticed, for Today's card.
export async function GET() {
  const requester = await homeRequester();
  if (!requester) return Response.json(null, { status: 401, headers: NO_STORE });
  try {
    return Response.json(await listHeadsups(requester.userId), { headers: NO_STORE });
  } catch (error) {
    console.error('Home heads-ups failed', error);
    return Response.json(null, { status: 500, headers: NO_STORE });
  }
}
