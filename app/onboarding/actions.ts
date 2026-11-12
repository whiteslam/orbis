'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/session';
import { setAiEnabled } from '@/lib/ai/preferences';
import type { ModuleId } from '@/lib/locale/person';
import { parseSettingsInput } from '@/lib/locale/settings-input';
import { writePersonSettings } from '@/lib/locale/settings-store';
import { getPersonalProfile } from '@/lib/personal/repository';
import { savePersonalProfile } from '@/lib/personal/profile-store';

type Result = { success: boolean; message: string };

const NOT_SAVED = 'Your settings could not be saved. Try again.';

/** Settings → You: time zone, currency, language and modules. */
export async function saveSettings(input: { timeZone: string; currency: string; locale: string; modules: ModuleId[] }): Promise<Result> {
  const auth = await requireUser();
  if (!auth) return { success: false, message: 'Sign in again to save your settings.' };
  const parsed = parseSettingsInput(input);
  if (!parsed.ok) return { success: false, message: parsed.message };
  // Settings always sends a language; only onboarding leaves it out.
  if (parsed.value.locale === undefined) return { success: false, message: 'Pick a valid language.' };
  if (!(await writePersonSettings(auth.supabase, auth.userId, parsed.value))) return { success: false, message: NOT_SAVED };
  revalidatePath('/active');
  return { success: true, message: 'Settings saved.' };
}

/**
 * The end of first-run onboarding: the name (through the same save as
 * Settings → You), the AI switch, then the settings row stamped onboarded.
 * The stamp goes last, so a step that fails leaves the person on onboarding to
 * try again rather than half set up. Language isn't asked yet: a new row gets
 * the default and an existing one keeps its own.
 */
export async function completeOnboarding(input: { preferredName: string; timeZone: string; currency: string; modules: ModuleId[]; aiEnabled: boolean }): Promise<Result> {
  const auth = await requireUser();
  if (!auth) return { success: false, message: 'Sign in again to finish setting up.' };
  if (!input || typeof input !== 'object' || typeof input.preferredName !== 'string' || typeof input.aiEnabled !== 'boolean') return { success: false, message: 'Review your answers and try again.' };
  const parsed = parseSettingsInput({ timeZone: input.timeZone, currency: input.currency, modules: input.modules });
  if (!parsed.ok) return { success: false, message: parsed.message };

  // A name is optional. When one is given, keep any work or "more about me" already saved.
  const preferredName = input.preferredName.trim();
  if (preferredName) {
    const existing = await getPersonalProfile(auth.userId);
    if (existing.state !== 'ready') return { success: false, message: 'Your name could not be saved right now. Leave it blank to carry on, and add it later in Settings.' };
    const saved = await savePersonalProfile(auth.supabase, auth.userId, { preferredName, role: existing.profile?.role ?? '', aboutMe: existing.profile?.aboutMe ?? '' });
    if (!saved.success) return saved;
  }

  // Off is the default, so only a failed "on" stops onboarding; turning it on is the consent to the disclosure shown beside it.
  const ai = await setAiEnabled(auth.userId, input.aiEnabled);
  if (!ai.ok && input.aiEnabled) return { success: false, message: `${ai.message} Leave AI off to carry on, and turn it on later in Settings.` };

  if (!(await writePersonSettings(auth.supabase, auth.userId, parsed.value, { onboarded: true }))) return { success: false, message: NOT_SAVED };
  revalidatePath('/active');
  return { success: true, message: 'You’re all set.' };
}
