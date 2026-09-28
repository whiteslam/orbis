/**
 * Whether Orbis may send anything to an AI provider for this person.
 *
 * Pure, so the page, the router and the tests all read the same rule. Both
 * halves are needed: the switch says what they want now, and the consent stamp
 * says they saw the disclosure and agreed to it at least once. A row that has
 * one without the other (written by hand, or half-migrated) counts as off.
 */
export type AiConsent = { aiEnabled: boolean; aiConsentedAt: string | null };

export function aiAllowed(prefs: AiConsent): boolean {
  return prefs.aiEnabled === true && typeof prefs.aiConsentedAt === 'string' && prefs.aiConsentedAt.length > 0;
}

export const AI_OFF_MESSAGE = 'AI features are off. Turn them on in Profile → Settings.';
