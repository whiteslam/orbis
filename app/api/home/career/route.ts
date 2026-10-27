import { composeCareerRow } from '@/lib/focus/career';
import { loadCareerToday } from '@/lib/career/today';
import { homeRequest, NO_STORE } from '@/lib/home/route-auth';

// GET /api/home/career → Home's Career row, or null before Career is set up.
// A route handler rather than a server action, like Home's other background
// reads, so it never holds up an action the user started.
export async function GET() {
  const { requester, status } = await homeRequest();
  if (!requester) return Response.json(null, { status, headers: NO_STORE });
  try {
    return Response.json(composeCareerRow(await loadCareerToday(requester.userId), new Date()), { headers: NO_STORE });
  } catch (error) {
    console.error('Home career row failed', error);
    return Response.json(null, { status: 500, headers: NO_STORE });
  }
}
