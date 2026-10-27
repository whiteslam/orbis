import 'server-only';

import type { CareerToday } from '@/lib/focus/career';
import { countForYou, getCareerRow, listApplications, listJobsByIds } from '@/lib/career/repository';

/**
 * What Home's Career row needs, read with the person's own session. Null
 * until Career is set up (no profile yet), which means no row at all.
 */
export async function loadCareerToday(userId: string): Promise<CareerToday | null> {
  const row = await getCareerRow(userId);
  if (!row?.profile) return null;
  const [apps, newMatches] = await Promise.all([
    listApplications(userId, { statuses: ['interview', 'offer', 'ready'], limit: 200 }),
    countForYou(userId, row.settings.threshold),
  ]);
  const companies = new Map((await listJobsByIds(userId, apps.map((app) => app.jobId))).map((job) => [job.id, job.company]));
  const company = (jobId: string) => companies.get(jobId) ?? 'a company';
  return {
    interviews: apps.filter((app) => app.status === 'interview').map((app) => ({ company: company(app.jobId), at: app.prep?.logistics.at ?? null })),
    offers: apps.filter((app) => app.status === 'offer').map((app) => ({ company: company(app.jobId) })),
    queue: apps.filter((app) => app.status === 'ready').length,
    newMatches,
  };
}
