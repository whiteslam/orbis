import 'server-only';

import type { SignedInSession } from '@/lib/auth/session';
import { parsePersonalProfile } from '@/lib/personal/profile-input';

/**
 * The one save for a personal profile: Settings → You and onboarding's name
 * both come through here. Checks the input, then writes the whole row.
 */
export async function savePersonalProfile(supabase: SignedInSession['supabase'], userId: string, value: unknown): Promise<{ success: boolean; message: string }> {
  const parsed = parsePersonalProfile(value);
  if (!parsed.ok) return { success: false, message: parsed.message };
  const { preferredName, role, aboutMe } = parsed.profile;

  const { error } = await supabase.from('user_personal_profiles').upsert(
    {
      user_id: userId,
      preferred_name: preferredName || null,
      role: role || null,
      about_me: aboutMe,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  );
  if (error) return { success: false, message: 'Profile could not be saved. Apply the Personal Profile migration in Supabase.' };
  return { success: true, message: 'Profile saved privately to your account.' };
}
