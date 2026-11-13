import { cookieRequest } from '@/lib/device/cookie-request';
import { createDeviceClient } from '@/lib/device/client';
import { readBodyCapped, revokeWithCredential } from '@/lib/device/service';

const NO_STORE = { 'cache-control': 'no-store' } as const;
const MAX_REVOKE_BYTES = 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// POST /api/device/revoke
// - With an `Authorization: Device <id>.<secret>` header: the phone signs itself out.
// - Otherwise, a signed-in person (cookie) sends { deviceId } to remove one of
//   their own phones. Row-level security limits the update to their rows.
// Revocation is one-way, so asking again for a phone that is already revoked
// is a quiet success.
export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Device ')) {
    const { status } = await revokeWithCredential(
      {
        async revoke(id, secret) {
          const { data, error } = await createDeviceClient().rpc('device_revoke', { p_device: id, p_secret: secret });
          if (error) throw error;
          return data === true;
        },
      },
      authHeader,
    );
    return status === 204
      ? new Response(null, { status, headers: NO_STORE })
      : Response.json({ error: status === 401 ? 'This phone is not signed in to Orbis.' : 'The phone could not be signed out. Try again later.' }, { status, headers: NO_STORE });
  }

  const who = await cookieRequest(request);
  if (!who.session) return Response.json({ error: who.status === 403 ? 'This request did not come from Orbis.' : 'Sign in to remove a phone.' }, { status: who.status, headers: NO_STORE });

  const text = await readBodyCapped(request, MAX_REVOKE_BYTES);
  if (text === null) return Response.json({ error: 'That request is too large.' }, { status: 413, headers: NO_STORE });
  let deviceId: unknown;
  try {
    deviceId = (JSON.parse(text) as { deviceId?: unknown } | null)?.deviceId;
  } catch {
    deviceId = undefined;
  }
  if (typeof deviceId !== 'string' || !UUID.test(deviceId)) return Response.json({ error: 'deviceId must be a UUID' }, { status: 400, headers: NO_STORE });

  // Only a phone that is still active: the database refuses any change to
  // revoked_at once it is set, so a repeat must not touch the row at all.
  const { error } = await who.session.supabase
    .from('devices')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', deviceId.toLowerCase())
    .is('revoked_at', null);
  if (error) {
    console.error('Device revoke failed', error.code ?? '');
    return Response.json({ error: 'The phone could not be removed. Try again in a little while.' }, { status: 500, headers: NO_STORE });
  }
  return new Response(null, { status: 204, headers: NO_STORE });
}
