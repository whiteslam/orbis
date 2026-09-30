import { timingSafeEqual } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { pushWaiting, scanDue } from '@/lib/headsups/scan';

export const maxDuration = 60;

const TIME_BUDGET_MS = 50_000;

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || secret.length < 32) return false;
  const provided = Buffer.from(request.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${secret}`);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

// Called every 15 minutes by pg_cron (supabase/cron/headsups_schedule.sql).
// Scans each person once a day, then sends any urgent heads-ups allowed out now.
export async function POST(request: Request) {
  if (!authorized(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const now = new Date();
  const deadline = Date.now() + TIME_BUDGET_MS;
  const admin = createAdminClient();
  try {
    const scan = await scanDue(admin, now, deadline);
    const push = await pushWaiting(admin, now, deadline);
    return Response.json({ ...scan, ...push });
  } catch (error) {
    console.error('Heads-up scan failed', error);
    return Response.json({ error: 'The scan could not run.' }, { status: 500 });
  }
}
