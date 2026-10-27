import { cronAuthorized } from '@/lib/cron/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { ingestDue } from '@/lib/career/ingest';

export const maxDuration = 60;

const TIME_BUDGET_MS = 50_000;

// Called every 3 hours by pg_cron (supabase/cron/career_schedule.sql). Fetches
// each person's due job sources, scores what's new and drafts the best few;
// whatever doesn't fit in the budget is carried to the next run.
export async function POST(request: Request) {
  if (!cronAuthorized(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const now = new Date();
  const deadline = Date.now() + TIME_BUDGET_MS;
  try {
    return Response.json(await ingestDue(createAdminClient(), now, deadline));
  } catch (error) {
    console.error('Career ingest failed', error);
    return Response.json({ error: 'The job search could not run.' }, { status: 500 });
  }
}
