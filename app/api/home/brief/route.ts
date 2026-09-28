import { loadHomeBrief } from '@/lib/home/brief-service';
import { homeRequester, NO_STORE } from '@/lib/home/route-auth';

// The weather Home already has, as JSON. Anything longer than a weather reading
// is not one, so it is ignored rather than parsed.
const MAX_WEATHER_LENGTH = 2_000;

function readWeatherParam(raw: string | null): unknown {
  if (!raw || raw.length > MAX_WEATHER_LENGTH) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// GET /api/home/brief?weather=<json> → the AI brief for today's data.
// A route handler rather than a server action: actions run one at a time per
// page, so a slow brief would hold up whatever the user taps next.
export async function GET(request: Request) {
  const requester = await homeRequester();
  if (!requester) return Response.json({ state: 'off' }, { status: 401, headers: NO_STORE });
  const weather = readWeatherParam(new URL(request.url).searchParams.get('weather'));
  try {
    return Response.json(await loadHomeBrief(requester.userId, { weather }), { headers: NO_STORE });
  } catch (error) {
    console.error('Home brief failed', error);
    return Response.json({ state: 'error', message: 'The brief could not be written right now.' }, { status: 500, headers: NO_STORE });
  }
}
