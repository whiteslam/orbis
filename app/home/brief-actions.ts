'use server';

import { requireUser } from '@/lib/auth/session';
import { revalidatePath } from 'next/cache';
import { setHomeBriefEnabled } from '@/lib/ai/preferences';

// Home reads the brief itself from GET /api/home/brief (lib/home/brief-service.ts);
// only the setting is changed through an action.

export async function setHomeBriefEnabledAction(enabled: unknown) {
  const auth = await requireUser();
  if (!auth) return { success: false, message: 'Sign in again to change this setting.' };
  if (typeof enabled !== 'boolean') return { success: false, message: 'That setting could not be saved.' };
  const result = await setHomeBriefEnabled(auth.userId, enabled);
  if (!result.ok) return { success: false, message: result.message };
  revalidatePath('/');
  return { success: true, message: enabled ? 'Orbis will write your brief from now on.' : 'The brief is back to Orbis’s own wording. Nothing is sent for it.' };
}
