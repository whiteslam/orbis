import { getImportantMail } from '@/lib/gmail/important';
import { homeRequester, NO_STORE } from '@/lib/home/route-auth';

// GET /api/home/mail → the important mail Home lists, read live from Gmail.
// A route handler rather than a server action, so a slow Gmail never holds up
// an action the user started.
export async function GET() {
  const requester = await homeRequester();
  if (!requester) return Response.json(null, { status: 401, headers: NO_STORE });
  try {
    return Response.json(await getImportantMail(requester.userId), { headers: NO_STORE });
  } catch (error) {
    console.error('Home mail failed', error);
    return Response.json(null, { status: 500, headers: NO_STORE });
  }
}
