'use server';

import { requireUser } from '@/lib/auth/session';
import { revalidatePath } from 'next/cache';
import { setAiEnabled, setHomeBriefEnabled } from '@/lib/ai/preferences';
import { getAiUsage } from '@/lib/ai/usage-store';
import type { UsageSummary } from '@/lib/ai/usage';

// Home reads the brief itself from GET /api/home/brief (lib/home/brief-service.ts);
// only the setting is changed through an action.

export async function setHomeBriefEnabledAction(enabled: unknown) {
  const auth = await requireUser();
  if (!auth) return { success: false, message: 'Sign in again to change this setting.' };
  if (typeof enabled !== 'boolean') return { success: false, message: 'That setting could not be saved.' };
  const result = await setHomeBriefEnabled(auth.userId, enabled);
  if (!result.ok) return { success: false, message: result.message };
  revalidatePath('/active');
  return { success: true, message: enabled ? 'Orbis will write your brief from now on.' : 'The brief is back to Orbis’s own wording. Nothing is sent for it.' };
}

/** The one AI switch. Turning it on is the consent to the disclosure shown beside it. */
export async function setAiEnabledAction(enabled: unknown) {
  const auth = await requireUser();
  if (!auth) return { success: false, message: 'Sign in again to change this setting.' };
  if (typeof enabled !== 'boolean') return { success: false, message: 'That setting could not be saved.' };
  const result = await setAiEnabled(auth.userId, enabled);
  if (!result.ok) return { success: false, message: result.message };
  revalidatePath('/active');
  return { success: true, message: enabled ? 'AI features are on.' : 'AI features are off. Nothing more is sent to an AI provider.' };
}

/** This month's AI use for the settings panel: the viewer's own calls, and the month's bill against the budget. */
export async function aiUsageAction(): Promise<UsageSummary | null> {
  const auth = await requireUser();
  if (!auth) return null;
  return getAiUsage(auth.userId);
}
