/**
 * Career: a salary written as words ("$170k to $230k", "70K-80K",
 * "US$228k - US$285k", "10-20 Lacs PA") read into numbers. Pure.
 *
 * Only ever given a field or line that is about pay, never a whole
 * description, where "401k" or "Series B" would fool it.
 */
import type { SalaryPeriod } from '../types.ts';
import type { Salary } from './common.ts';

/** Marks checked in order, so "US$" wins over "$". */
const SYMBOLS: Array<[string, string]> = [
  ['us$', 'USD'], ['ca$', 'CAD'], ['c$', 'CAD'], ['au$', 'AUD'], ['a$', 'AUD'], ['s$', 'SGD'],
  ['€', 'EUR'], ['£', 'GBP'], ['₹', 'INR'], ['$', 'USD'],
];
const CODES = /\b(usd|eur|gbp|inr|cad|aud|chf|sgd|nzd|sek|nok|dkk|pln|jpy)\b/;
const INDIAN_UNITS = /\b(lpa|lakhs?|lacs?|crores?|ctc)\b/;

function currencyIn(lower: string) {
  for (const [mark, code] of SYMBOLS) {
    if (lower.includes(mark)) return code;
  }
  const code = CODES.exec(lower);
  if (code) return code[1].toUpperCase();
  if (INDIAN_UNITS.test(lower) || lower.includes('rs.')) return 'INR';
  return null;
}

function periodIn(lower: string): SalaryPeriod {
  if (lower.includes('hour') || lower.includes('/hr') || lower.includes('/h ') || lower.endsWith('/h')) return 'hour';
  if (lower.includes('month') || lower.includes('/mo')) return 'month';
  return 'year';
}

const isLetter = (char: string | undefined) => char !== undefined && char.toLowerCase() !== char.toUpperCase();

/** The multiplier a unit right after a number stands for, or 1. */
function unitAt(lower: string, from: number) {
  let at = from;
  while (lower[at] === ' ') at += 1;
  for (const [word, factor] of [['lakhs', 1e5], ['lakh', 1e5], ['lacs', 1e5], ['lac', 1e5], ['lpa', 1e5], ['crores', 1e7], ['crore', 1e7], ['cr', 1e7]] as const) {
    if (lower.startsWith(word, at) && !isLetter(lower[at + word.length])) return factor;
  }
  if (lower[at] === 'k' && !isLetter(lower[at + 1])) return 1e3;
  if (lower[at] === 'm' && !isLetter(lower[at + 1])) return 1e6;
  if (lower[at] === 'l' && !isLetter(lower[at + 1])) return 1e5;
  return 1;
}

/** "120,000" → 120000, "50.000" → 50000, "12.5" → 12.5, "35,3" → 35.3. */
function readNumber(raw: string) {
  const comma = raw.indexOf(',');
  // One comma with one or two digits after it is a decimal comma ("35,3k").
  if (comma !== -1 && comma === raw.lastIndexOf(',') && !raw.includes('.') && raw.length - comma - 1 <= 2) {
    return Number.parseFloat(raw.replace(',', '.'));
  }
  const digits = raw.replaceAll(',', '');
  const dot = digits.lastIndexOf('.');
  // A dot followed by exactly three digits is a thousands separator ("50.000").
  const value = dot !== -1 && digits.length - dot - 1 === 3 ? digits.replaceAll('.', '') : digits;
  return Number.parseFloat(value);
}

/** Up to two amounts in the text, each with the unit written after it. */
function amountsIn(lower: string) {
  const found: Array<{ value: number; factor: number }> = [];
  for (const match of lower.matchAll(/\d[\d,.]*/g)) {
    let raw = match[0];
    while (raw.endsWith('.') || raw.endsWith(',')) raw = raw.slice(0, -1);
    const value = readNumber(raw);
    if (!Number.isFinite(value)) continue;
    found.push({ value, factor: unitAt(lower, match.index + raw.length) });
    if (found.length === 2) break;
  }
  // "10-20 Lacs": a unit after the second figure covers the first.
  if (found.length === 2 && found[0].factor === 1) found[0].factor = found[1].factor;
  return found.map(({ value, factor }) => Math.round(value * factor));
}

/** "per year", "per hour"… are pay; "per task" or "per day" can't be stored as a salary. */
const PER_OK = new Set(['year', 'annum', 'month', 'hour', 'yr', 'mo', 'hr']);

function paidPerSomethingElse(lower: string) {
  let at = lower.indexOf('per ');
  while (at !== -1) {
    // "upper " isn't "per ".
    if (!isLetter(lower[at - 1])) {
      const word = [...lower.slice(at + 4, at + 20)].filter((char) => isLetter(char) || char === ' ').join('').split(' ')[0];
      if (!PER_OK.has(word)) return true;
    }
    at = lower.indexOf('per ', at + 4);
  }
  return false;
}

export type SalaryHints = { currency?: string; period?: SalaryPeriod };

/** The salary a line states, or null when it has no figure, no currency, or numbers too small to be pay. */
export function parseSalaryText(text: string, hints: SalaryHints = {}): Salary | null {
  const lower = text.toLowerCase();
  const currency = currencyIn(lower) ?? hints.currency ?? null;
  const amounts = amountsIn(lower);
  if (!currency || amounts.length === 0 || amounts.some((amount) => amount <= 0) || paidPerSomethingElse(lower)) return null;

  const period = hints.period ?? periodIn(lower);
  let min: number | null = Math.min(...amounts);
  let max: number | null = Math.max(...amounts);
  // A yearly figure under 1 000 is a missing "k", not a salary.
  if (period === 'year' && max < 1000) return null;
  if (amounts.length === 1 && lower.includes('up to')) min = null;
  else if (amounts.length === 1 && (lower.includes('from') || lower.includes('+'))) max = null;
  return { min, max, currency, period };
}
