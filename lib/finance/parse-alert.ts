export type ParsedTransactionProposal = {
  parsedAmount: number | null;
  parsedCurrency: string | null;
  parsedDirection: 'expense' | 'income' | null;
  parsedMerchant: string | null;
  parseStatus: 'needs_review' | 'unrecognized';
  parseReason: string;
};

const moneyPattern = /(?:\b(?:INR|Rs\.?|USD|US\$|EUR|GBP)\s*|[₹$€£]\s*)([0-9][0-9,]*(?:\.\d{1,2})?)/gi;
const directionPattern = {
  expense: /\b(debited|debit|spent|purchase|paid|withdrawn|deducted|charged|pos txn|card transaction)\b/i,
  income: /\b(credited|credit|refund(?:ed)?|received|deposited|reversal)\b/i,
};

function currencyFor(match: string) {
  if (/^(?:INR|Rs\.?|₹)/i.test(match)) return 'INR';
  if (/^(?:USD|US\$|\$)/i.test(match)) return 'USD';
  if (/^(?:EUR|€)/i.test(match)) return 'EUR';
  if (/^(?:GBP|£)/i.test(match)) return 'GBP';
  return null;
}

function parseSegment(segment: string) {
  const amounts: Array<{ amount: number; currency: string }> = [];
  for (const match of segment.matchAll(moneyPattern)) {
    const currency = currencyFor(match[0]);
    const amount = Number(match[1].replace(/,/g, ''));
    if (currency && Number.isFinite(amount) && amount > 0 && amount <= 100_000_000) {
      amounts.push({ amount: Number(amount.toFixed(2)), currency });
    }
  }
  const expense = directionPattern.expense.test(segment);
  const income = directionPattern.income.test(segment);
  const direction = expense === income ? null : expense ? 'expense' as const : 'income' as const;
  return { amounts, direction };
}

function parseMerchant(segment: string) {
  const labeled = segment.match(/\b(?:merchant(?: name)?|paid to)\s*[:\-]\s*([^\n,;]{2,80})/i);
  const nearby = labeled ?? segment.match(/\b(?:at|to)\s+([^\n,;]{2,80})/i);
  if (!nearby?.[1]) return null;
  const merchant = nearby[1]
    .replace(/\s+(?:on|using|via|ref(?:erence)?|rrn|upi|txn|transaction|available balance|a\/c)\b.*$/i, '')
    .replace(/[*.#xX0-9]{3,}/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  if (!merchant || /^(?:INR|Rs\.?|USD|EUR|GBP|₹|\$|€|£)$/i.test(merchant)) return null;
  return merchant;
}

function splitTransactionSegments(body: string) {
  // Split on line breaks and sentence endings, while preserving decimal points.
  return body
    .split(/\n+|(?<=[.!?])\s+(?=[^\d\s])/)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

export function parseTransactionAlert(body: string): ParsedTransactionProposal {
  const segments = splitTransactionSegments(body.slice(0, 100_000));
  const candidates = segments
    .map((segment) => ({ segment, ...parseSegment(segment) }))
    .filter(({ amounts, direction }) => amounts.length > 0 || direction !== null);

  // Never combine an amount from one sentence with a debit/credit label from
  // another. Multiple candidate segments or multiple amounts are ambiguous.
  const candidate = candidates.length === 1 ? candidates[0] : null;
  const amount = candidate?.amounts.length === 1 ? candidate.amounts[0] : null;
  const direction = candidate?.direction ?? null;
  const complete = Boolean(amount && direction);

  return {
    parsedAmount: amount?.amount ?? null,
    parsedCurrency: amount?.currency ?? null,
    parsedDirection: direction,
    parsedMerchant: candidate ? parseMerchant(candidate.segment) : null,
    parseStatus: complete ? 'needs_review' : 'unrecognized',
    parseReason: complete
      ? 'Orbis found transaction details. Review them before saving.'
      : 'Orbis could not confidently identify all transaction details. Fill in the missing values or ignore this alert.',
  };
}
