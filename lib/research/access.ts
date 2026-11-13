/**
 * Who may use the Research desk.
 *
 * Security-specific Buy/Sell calls for anyone but the owner very likely count
 * as research-analyst or adviser activity under SEBI rules, so the desk is
 * owner-only (the spec's decision 1). The 'owner' role (public.account_roles)
 * opens it. ORBIS_RESEARCH_DESK_EMAILS stays as a fallback for an owner whose
 * role is not granted yet, and unlike ORBIS_ALLOWED_EMAILS an empty list means
 * nobody: a forgotten variable shuts the desk instead of opening it to everyone.
 */

import type { Role } from '@/lib/security/role';

export function researchDeskEmails(): string[] {
  return (process.env.ORBIS_RESEARCH_DESK_EMAILS ?? '')
    .split(/[,\s]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

export function researchDeskAllowed(role: Role, email: string | null | undefined): boolean {
  if (role === 'owner') return true;
  const address = email?.trim().toLowerCase();
  return Boolean(address) && researchDeskEmails().includes(address as string);
}

/**
 * Whether the desk shows at all: the owner, on a deployment whose worker is
 * set up (the dispatch env vars). Until both are true nothing appears and no
 * Research desk table is queried, so a deployment without the migration or
 * the worker is unaffected.
 */
export function researchDeskAvailable(role: Role, email: string | null | undefined, workerConfigured: boolean): boolean {
  return workerConfigured && researchDeskAllowed(role, email);
}
