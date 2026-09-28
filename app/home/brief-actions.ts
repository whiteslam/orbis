'use server';

import { revalidatePath } from 'next/cache';
import { setHomeBriefEnabled } from '@/lib/ai/preferences';
import { createClient } from '@/lib/supabase/server';
import { isAppUnlocked } from '@/lib/security/app-lock';

// Home reads the brief itself from GET /api/home/brief (lib/home/brief-service.ts);
// only the setting is changed through an action.

async function authed() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (error || typeof userId !== 'string') return null;
  if (!(await isAppUnlocked(data?.claims))) return null;
  return { supabase, userId };
}

export async function setHomeBriefEnabledAction(enabled: unknown) {
  const auth = await authed();
  if (!auth) return { success: false, message: 'Sign in again to change this setting.' };
  if (typeof enabled !== 'boolean') return { success: false, message: 'That setting could not be saved.' };
  const result = await setHomeBriefEnabled(auth.userId, enabled);
  if (!result.ok) return { success: false, message: result.message };
  revalidatePath('/');
  return { success: true, message: enabled ? 'Orbis will write your brief from now on.' : 'The brief is back to Orbis’s own wording. Nothing is sent for it.' };
}
