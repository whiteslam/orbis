import { cronAuthorized } from '@/lib/cron/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { watchDue } from '@/lib/career/watch';

export const maxDuration = 60;

const TIME_BUDGET_MS = 50_000;

// Called every 15 minutes by pg_cron (supabase/cron/career_schedule.sql). Reads
// job-alert emails and replies, then drafts due follow-ups and marks silent
// applications ghosted. Urgent heads-ups it raises go out with the heads-up
// cron's pushes (app/api/headsups/scan).
export async function POST(request: Request) {
  if (!cronAuthorized(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const now = new Date();
  const deadline = Date.now() + TIME_BUDGET_MS;
  try {
    return Response.json(await watchDue(createAdminClient(), now, deadline));
  } catch (error) {
    console.error('Career watch failed', error);
    return Response.json({ error: 'The mail watch could not run.' }, { status: 500 });
  }
}
