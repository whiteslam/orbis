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

// Mailbox names machines send from. A "-tag" or "+tag" after the name still counts.
const automatedLocalParts = [
  /^(?:no|do[-_.]?not)[-_.]?reply$/i,
  /^(?:alert|notification|statement|update|bounce)s?$/i,
  /^(?:notify|mailer(?:-daemon)?|otp|system)$/i,
];

function isAutomatedSender(address: string) {
  const at = address.indexOf('@');
  if (at === -1) return false;
  const local = address.slice(0, at);
  for (let end = 0; end <= local.length; end++) {
    if (end < local.length && !'-_.+'.includes(local[end])) continue;
    const name = local.slice(0, end);
    if (automatedLocalParts.some((pattern) => pattern.test(name))) return true;
  }
  return false;
}

const alertSubject = new RegExp([
  String.raw`\b(otp|one[- ]time (password|code)|verification code|security code|passcode)\b`,
  String.raw`\b(debited|credited|transaction|txn|a/c|account statement|e-?statement|mini statement)\b`,
  String.raw`\b(payment (received|successful|failed|due)|auto[- ]?debit|emi|mandate)\b`,
  String.raw`\b(security alert|new sign[- ]?in|login alert|sign[- ]?in attempt|password (reset|changed))\b`,
].join('|'), 'i');

/** The first `<…>` in a From header at or after `start`, as the indexes of its brackets. */
function angleBrackets(from: string, start = 0) {
  const open = from.indexOf('<', start);
  if (open === -1) return null;
  const close = from.indexOf('>', open + 1);
  return close === -1 ? null : { open, close };
}

/** The bare address out of a From header, lower-cased. */
export function senderAddress(from: string) {
  let brackets = angleBrackets(from);
  // An empty `<>` is skipped, as if it were not there.
  while (brackets && brackets.close === brackets.open + 1) brackets = angleBrackets(from, brackets.close + 1);
  return (brackets ? from.slice(brackets.open + 1, brackets.close) : from).trim().toLowerCase();
}

/** The display name out of a From header, falling back to the address. */
export function senderName(from: string) {
  const brackets = angleBrackets(from);
  const withoutAddress = brackets ? from.slice(0, brackets.open) + from.slice(brackets.close + 1) : from;
  const name = withoutAddress.trim().replace(/^"|"$/g, '').trim();
  return name || senderAddress(from);
}

export function isAlertMail(headers: MailHeaders) {
  if (isAutomatedSender(senderAddress(headers.from))) return true;
  if (alertSubject.test(headers.subject)) return true;
  if (headers.autoSubmitted && headers.autoSubmitted.toLowerCase() !== 'no') return true;
  if (headers.precedence && /^(bulk|list|junk)$/i.test(headers.precedence.trim())) return true;
  return Boolean(headers.listUnsubscribe);
}
