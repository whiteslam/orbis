/**
 * Who may use the Research desk.
 *
 * Security-specific Buy/Sell calls for anyone but the owner very likely count
 * as research-analyst or adviser activity under SEBI rules, so the desk is
 * owner-only (the spec's decision 1). ORBIS_RESEARCH_DESK_EMAILS lists who may
 * use it, and unlike ORBIS_ALLOWED_EMAILS an empty list means nobody: a
 * forgotten variable shuts the desk instead of opening it to everyone.
 */

export function researchDeskEmails(): string[] {
  return (process.env.ORBIS_RESEARCH_DESK_EMAILS ?? '')
    .split(/[,\s]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

export function researchDeskAllowed(email: string | null | undefined): boolean {
  const address = email?.trim().toLowerCase();
  return Boolean(address) && researchDeskEmails().includes(address as string);
}

/**
 * Whether the desk shows at all: the owner, on a deployment whose worker is
 * set up (the dispatch env vars). Until both are true nothing appears and no
 * Research desk table is queried, so a deployment without the migration or
 * the worker is unaffected.
 */
export function researchDeskAvailable(email: string | null | undefined, workerConfigured: boolean): boolean {
  return workerConfigured && researchDeskAllowed(email);
}
