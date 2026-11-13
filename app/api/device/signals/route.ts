import { createDeviceClient } from '@/lib/device/client';
import { deviceCredential, MAX_BODY_BYTES } from '@/lib/device/http';
import { readBodyCapped, syncDevice, type SyncResult } from '@/lib/device/service';
import { encryptForUser, phoneDataReady } from '@/lib/crypto/user-keys';

const NO_STORE = { 'cache-control': 'no-store' } as const;

// POST /api/device/signals: one sync from a phone, signed with
// `Authorization: Device <deviceId>.<secret>`. No cookie, no CSRF surface:
// the credential is the only way in. Signal text is encrypted here, per user,
// before it reaches the database.
export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization');
  // Don't buffer a body for a caller that can't be a phone.
  if (!deviceCredential(authHeader)) return Response.json({ error: 'This phone is not signed in to Orbis.' }, { status: 401, headers: NO_STORE });

  const text = await readBodyCapped(request, MAX_BODY_BYTES);
  if (text === null) return Response.json({ error: 'request body too large' }, { status: 413, headers: NO_STORE });

  const db = createDeviceClient();
  const { status, body } = await syncDevice(
    {
      async whoami(id, secret) {
        const { data, error } = await db.rpc('device_whoami', { p_device: id, p_secret: secret });
        if (error) throw error;
        return typeof data === 'string' ? data : null;
      },
      async sync({ deviceId, secret, meta, sources, signals, ledger }) {
        const { data, error } = await db.rpc('device_sync', {
          p_device: deviceId,
          p_secret: secret,
          p_meta: meta,
          p_sources: sources,
          p_signals: signals,
          p_ledger: ledger,
        });
        if (error) throw error;
        return (data as SyncResult | null) ?? null;
      },
      ready: () => phoneDataReady(),
      encrypt: encryptForUser,
    },
    authHeader,
    text,
    new Date(),
  );
  return Response.json(body, { status, headers: NO_STORE });
}
