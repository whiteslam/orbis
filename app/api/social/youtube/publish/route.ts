import { cronAuthorized } from '@/lib/cron/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { publishDue } from '@/lib/youtube/publish';

export const maxDuration = 60;

const TIME_BUDGET_MS = 50_000;

// Called every 10 minutes by pg_cron (supabase/cron/youtube_schedule.sql).
// Finishes uploads under way, then posts the next short for each person whose
// time has come, from the private shorts bucket, while the time budget lasts.
export async function POST(request: Request) {
  if (!cronAuthorized(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const now = new Date();
  const deadline = Date.now() + TIME_BUDGET_MS;
  try {
    const counts = await publishDue(createAdminClient(), now, deadline);
    if (counts.users === 0) return new Response(null, { status: 204 });
    return Response.json(counts);
  } catch (error) {
    console.error('YouTube publish run failed', error);
    return Response.json({ error: 'The YouTube publish run could not finish.' }, { status: 500 });
  }
}
