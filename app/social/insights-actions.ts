'use server';

import { getAuthenticatedUserId } from '@/lib/auth/session';
import { loadPlatformInsights } from '@/lib/social/insights';
import type { PlatformInsights } from '@/lib/social/insights-shape';
import { rateLimitRefusal } from '@/lib/security/rate-limit';

type Result = { success: boolean; message: string; platforms: PlatformInsights[] };

/** Instagram and Threads numbers for the Social tab, read live from Meta. */
export async function loadSocialInsightsAction(): Promise<Result> {
  const userId = await getAuthenticatedUserId();
  if (!userId) return { success: false, message: 'Sign in again to see insights.', platforms: [] };
  const refusal = await rateLimitRefusal(userId, 'insights');
  if (refusal) return { success: false, message: refusal, platforms: [] };
  try {
    const platforms = await Promise.all((['instagram', 'threads'] as const).map((platform) => loadPlatformInsights(userId, platform)));
    return { success: true, message: '', platforms };
  } catch (error) {
    console.error('Loading social insights failed', error);
    return { success: false, message: 'Insights could not be loaded. Try again.', platforms: [] };
  }
}
