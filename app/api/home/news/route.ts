import { getNewsDigest } from '@/lib/news/digest';
import { homeRequester, NO_STORE } from '@/lib/home/route-auth';

// GET /api/home/news → today's headlines and the AI's market reading of them.
// A route handler rather than a server action, so a slow news API or model
// never holds up an action the user started.
export async function GET() {
  const requester = await homeRequester();
  if (!requester) return Response.json(null, { status: 401, headers: NO_STORE });
  try {
    return Response.json(await getNewsDigest(requester.userId), { headers: NO_STORE });
  } catch (error) {
    console.error('Home news failed', error);
    return Response.json(null, { status: 500, headers: NO_STORE });
  }
}
