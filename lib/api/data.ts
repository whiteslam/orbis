import 'server-only';

import { getAiPreferences } from '@/lib/ai/preferences';
import { getLatestAiResult } from '@/lib/ai/results';
import { getFinanceSummary } from '@/lib/finance/repository';
import { getHealthLibrary } from '@/lib/health-docs/repository';
import { getStepsSummary } from '@/lib/health/steps-repository';
import { getJournal } from '@/lib/journal/repository';
import { getContextNotes } from '@/lib/memory/notes';
import { getNotificationSettings } from '@/lib/notifications/repository';
import { getFitnessPersona, getHomeLocation, getPersonalProfile } from '@/lib/personal/repository';
import { getAppConnections, getIntegrationStatus } from '@/lib/providers/status';
import { getRoutinesSummary } from '@/lib/routines/repository';
import { getSocialConnections } from '@/lib/social/connections';

type Reader = (who: { userId: string; email: string | null }) => Promise<unknown>;

/**
 * What GET /api/v1/data/<area> returns: the same summaries the app page loads
 * for its tabs (app/(orbis)/active/page.tsx), so the API shows exactly what
 * the app shows. A month of social posts is the social.loadMonth action.
 */
export const API_DATA: Record<string, Reader> = {
  finance: ({ userId }) => getFinanceSummary(userId),
  notes: ({ userId }) => getContextNotes(userId),
  fitness: ({ userId }) => getFitnessPersona(userId),
  profile: ({ userId }) => getPersonalProfile(userId),
  'home-location': ({ userId }) => getHomeLocation(userId),
  steps: ({ userId }) => getStepsSummary(userId),
  journal: ({ userId }) => getJournal(userId),
  notifications: ({ userId }) => getNotificationSettings(userId),
  'health-library': ({ userId }) => getHealthLibrary(userId),
  'workbook-advice': ({ userId }) => getLatestAiResult(userId, 'workbook_advice'),
  'portfolio-advice': ({ userId }) => getLatestAiResult(userId, 'portfolio_advice'),
  'ai-preferences': ({ userId }) => getAiPreferences(userId),
  routines: ({ userId }) => getRoutinesSummary(userId),
  'social-connections': ({ userId }) => getSocialConnections(userId),
  integrations: ({ userId, email }) => getIntegrationStatus(userId, email),
  'app-connections': ({ userId, email }) => getAppConnections(userId, email),
};

export function apiData(area: string): Reader | null {
  return Object.hasOwn(API_DATA, area) ? API_DATA[area] : null;
}
