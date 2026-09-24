import { getAuthenticatedUserId } from '@/lib/gmail/oauth';
import { friendlyProviderMessage } from '@/lib/providers/core';
import { getWeather } from '@/lib/providers/weather';
import { createClient } from '@/lib/supabase/server';

// GET /api/weather?lat=…&lon=…   → weather at the browser's location
// GET /api/weather                → weather at the user's saved home city
export async function GET(request: Request) {
  const userId = await getAuthenticatedUserId();
  if (!userId) return Response.json({ error: 'Sign in again to see the weather.' }, { status: 401 });

  const params = new URL(request.url).searchParams;
  let latitude: number;
  let longitude: number;
  let place: string | null = null;

  if (params.has('lat') || params.has('lon')) {
    // Number('') is 0, so require real decimal numbers before converting.
    const decimal = /^-?\d{1,3}(\.\d{1,8})?$/;
    const rawLat = params.get('lat') ?? '';
    const rawLon = params.get('lon') ?? '';
    latitude = Number(rawLat);
    longitude = Number(rawLon);
    if (!decimal.test(rawLat) || !decimal.test(rawLon) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
      return Response.json({ error: 'That location is not valid.' }, { status: 400 });
    }
  } else {
    const supabase = await createClient();
    const { data, error } = await supabase.from('user_locations').select('city,latitude,longitude').eq('user_id', userId).maybeSingle();
    if (error || !data) return Response.json({ needsCity: true });
    latitude = Number(data.latitude);
    longitude = Number(data.longitude);
    place = data.city;
  }

  try {
    const weather = await getWeather(latitude, longitude);
    return Response.json({ ...weather.data, place, fetchedAt: weather.fetchedAt, stale: weather.stale }, { headers: { 'cache-control': 'private, max-age=600' } });
  } catch (error) {
    return Response.json({ error: friendlyProviderMessage(error) }, { status: 503 });
  }
}
