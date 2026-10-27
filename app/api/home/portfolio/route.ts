import { loadBriefPortfolio } from '@/lib/home/portfolio-service';
import { homeRequest, NO_STORE } from '@/lib/home/route-auth';

// GET /api/home/portfolio → the few portfolio numbers the Home brief reads.
// A route handler rather than a server action, so a slow broker never holds up
// an action the user started.
export async function GET() {
  const { requester, status } = await homeRequest();
  if (!requester) return Response.json(null, { status, headers: NO_STORE });
  try {
    return Response.json(await loadBriefPortfolio(requester.userId, requester.email), { headers: NO_STORE });
  } catch (error) {
    console.error('Home portfolio failed', error);
    return Response.json(null, { status: 500, headers: NO_STORE });
  }
}
