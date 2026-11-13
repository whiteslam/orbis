/**
 * Checks a personal profile sent from Settings or onboarding. Pure, so both
 * save through one tested rule (lib/personal/profile-store.ts).
 */

export type ProfileInput = { preferredName: string; role: string; aboutMe: string };

export type ParsedProfile = { ok: true; profile: ProfileInput } | { ok: false; message: string };

export function parsePersonalProfile(value: unknown): ParsedProfile {
  const invalid: ParsedProfile = { ok: false, message: 'Review your profile details and try again.' };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid;
  const input = value as Record<string, unknown>;
  if (typeof input.preferredName !== 'string' || typeof input.role !== 'string' || typeof input.aboutMe !== 'string') return invalid;
  const preferredName = input.preferredName.trim();
  const role = input.role.trim();
  const aboutMe = input.aboutMe.trim();
  if (preferredName.length > 80) return { ok: false, message: 'Keep your preferred name under 80 characters.' };
  if (role.length > 120) return { ok: false, message: 'Keep your work or role under 120 characters.' };
  if (aboutMe.length > 3000) return { ok: false, message: 'Keep “More about me” under 3,000 characters.' };
  if (!preferredName && !role && !aboutMe) return { ok: false, message: 'Add at least one detail before saving.' };
  return { ok: true, profile: { preferredName, role, aboutMe } };
}
