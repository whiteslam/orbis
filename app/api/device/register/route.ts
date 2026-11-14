import { cookieRequest } from '@/lib/device/cookie-request';
import { MAX_ACTIVE_DEVICES, newDeviceSecret, parseRegister, secretHash } from '@/lib/device/http';
import { readBodyCapped } from '@/lib/device/service';
import { rateLimitRefusal } from '@/lib/security/rate-limit';

const NO_STORE = { 'cache-control': 'no-store' } as const;
const MAX_REGISTER_BYTES = 4096;

// POST /api/device/register { name, flavour, appVersion } -> 201 { deviceId, secret }
// Called by the signed-in page with the person's cookie; the page hands the
// result to the Android app. The secret is shown here once: only its hash is
// stored. After this the phone uses `Authorization: Device <deviceId>.<secret>`.
export async function POST(request: Request) {
  const who = await cookieRequest(request);
  if (!who.session) return Response.json({ error: who.status === 403 ? 'This request did not come from Orbis.' : 'Sign in to add a phone.' }, { status: who.status, headers: NO_STORE });
  const { supabase, userId } = who.session;

  const text = await readBodyCapped(request, MAX_REGISTER_BYTES);
  if (text === null) return Response.json({ error: 'That request is too large.' }, { status: 413, headers: NO_STORE });
  const input = parseRegister(text);
  if (typeof input === 'string') return Response.json({ error: input }, { status: 400, headers: NO_STORE });

  const refusal = await rateLimitRefusal(userId, 'device_register');
  if (refusal) return Response.json({ error: refusal }, { status: 429, headers: NO_STORE });

  try {
    const { count, error: countError } = await supabase
      .from('devices')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .is('revoked_at', null);
    if (countError) throw countError;
    if ((count ?? 0) >= MAX_ACTIVE_DEVICES) {
      return Response.json({ error: `You have ${MAX_ACTIVE_DEVICES} phones signed in. Remove one in Settings → Phone access.` }, { status: 409, headers: NO_STORE });
    }

    const secret = newDeviceSecret();
    // Name the columns: devices does not grant secret_hash or push_token back, so select('*') is refused.
    const { data, error } = await supabase
      .from('devices')
      .insert({ user_id: userId, name: input.name, flavour: input.flavour, app_version: input.appVersion, secret_hash: secretHash(secret) })
      .select('id')
      .single();
    if (error) throw error;
    return Response.json({ deviceId: data.id, secret }, { status: 201, headers: NO_STORE });
  } catch (error) {
    console.error('Device register failed', error instanceof Error ? error.name : typeof error, (error as { code?: unknown } | null)?.code ?? '');
    return Response.json({ error: 'Your phone couldn’t be added. Try again in a little while.' }, { status: 500, headers: NO_STORE });
  }
}
