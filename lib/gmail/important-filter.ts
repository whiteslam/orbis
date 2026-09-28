// Which messages count as "important mail" on Home. Gmail's own Important +
// Primary search does most of the work; this drops what still slips through:
// bank and card alerts, OTPs, sign-in notices and other machine-sent mail.
// No server-only import, so the unit tests can load it directly.

export type MailHeaders = {
  from: string;
  subject: string;
  /** Present on newsletters and most automated senders. */
  listUnsubscribe?: string;
  precedence?: string;
  autoSubmitted?: string;
};

const automatedSender = /^(no[-_.]?reply|do[-_.]?not[-_.]?reply|alerts?|notifications?|notify|mailer(-daemon)?|otp|statements?|updates?|bounces?|system)([-_.+][^@]*)?@/i;

const alertSubject = new RegExp([
  '\\b(otp|one[- ]time (password|code)|verification code|security code|passcode)\\b',
  '\\b(debited|credited|transaction|txn|a/c|account statement|e-?statement|mini statement)\\b',
  '\\b(payment (received|successful|failed|due)|auto[- ]?debit|emi|mandate)\\b',
  '\\b(security alert|new sign[- ]?in|login alert|sign[- ]?in attempt|password (reset|changed))\\b',
].join('|'), 'i');

/** The bare address out of a From header, lower-cased. */
export function senderAddress(from: string) {
  const bracketed = from.match(/<([^>]+)>/);
  return (bracketed ? bracketed[1] : from).trim().toLowerCase();
}

/** The display name out of a From header, falling back to the address. */
export function senderName(from: string) {
  const name = from.replace(/<[^>]*>/, '').trim().replace(/^"|"$/g, '').trim();
  return name || senderAddress(from);
}

export function isAlertMail(headers: MailHeaders) {
  if (automatedSender.test(senderAddress(headers.from))) return true;
  if (alertSubject.test(headers.subject)) return true;
  if (headers.autoSubmitted && headers.autoSubmitted.toLowerCase() !== 'no') return true;
  if (headers.precedence && /^(bulk|list|junk)$/i.test(headers.precedence.trim())) return true;
  return Boolean(headers.listUnsubscribe);
}
