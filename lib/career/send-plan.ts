/**
 * The pieces of Send that need no network: the email's subject, body and
 * attachment name, the Gmail compose link for an owner without the send
 * permission, the Recruitee endpoint, the reply headers for a follow-up, and
 * the paste kit for a link apply. Pure and client-safe.
 */
import type { CareerApplication, CareerContact, CareerProfile, CareerSpec, Money, NormalizedJob } from './types.ts';

/** One line of header text: line breaks and runs of space collapse, so nothing can be smuggled into a header. */
export function oneLine(text: string, max = 200): string {
  return text.replaceAll(/[\r\n\t]+/g, ' ').replaceAll(/\s{2,}/g, ' ').trim().slice(0, max);
}

/** "Application: Frontend Engineer — Asha Rao". */
export function applicationSubject(title: string, name: string): string {
  const who = oneLine(name, 80);
  const role = oneLine(title, 120);
  return who ? `Application: ${role} — ${who}` : `Application: ${role}`;
}

const LINKEDIN = /(^|\.)linkedin\.com$/i;

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

const isLinkedIn = (url: string) => LINKEDIN.test(hostOf(url) ?? '');

/** The short signature under the note: name, then phone and email, then one profile link (LinkedIn first). */
export function signature(contact: Pick<CareerContact, 'name' | 'email' | 'phone' | 'links'>): string {
  const lines = [contact.name.trim()];
  const reach = [contact.phone?.trim(), contact.email.trim()].filter(Boolean).join(' · ');
  if (reach) lines.push(reach);
  const link = contact.links.find((item) => isLinkedIn(item.url)) ?? contact.links[0];
  if (link?.url) lines.push(link.url.trim());
  return lines.filter(Boolean).join('\n');
}

/** The email's body: the cover note as the owner approved it, then the signature. */
export function applicationBody(coverNote: string | null, contact: Pick<CareerContact, 'name' | 'email' | 'phone' | 'links'>): string {
  const note = (coverNote ?? '').trim();
  const sign = signature(contact);
  return [note, sign].filter(Boolean).join('\n\n');
}

/** "Asha Rao - Resume.pdf"; only characters every mail client and file system takes. */
export function resumeFileName(name: string, extension: 'pdf' | 'docx' = 'pdf'): string {
  const clean = oneLine(name, 80).replaceAll(/[\\/:*?"<>|]+/g, ' ').replaceAll(/\s{2,}/g, ' ').trim();
  return clean ? `${clean} - Resume.${extension}` : `Resume.${extension}`;
}

/**
 * Gmail's compose window takes everything in the URL, and long URLs are cut by
 * browsers and proxies, so the body is capped. The owner sees the whole note in
 * Orbis and can paste the rest.
 */
export const COMPOSE_BODY_MAX = 1500;

/** A prefilled Gmail compose window: to, subject and body, URL-encoded, the body capped. */
export function composeUrl(input: { to: string; subject: string; body: string }, maxBody = COMPOSE_BODY_MAX): string {
  const body = input.body.length > maxBody ? `${input.body.slice(0, maxBody - 1).trimEnd()}…` : input.body;
  const params = [
    ['view', 'cm'],
    ['fs', '1'],
    ['to', oneLine(input.to, 320)],
    ['su', oneLine(input.subject, 200)],
    ['body', body],
  ];
  return `https://mail.google.com/mail/?${params.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&')}`;
}

const SUBDOMAIN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/i;
const SLUG = /^[\w-]{1,200}$/;

/**
 * Recruitee's candidate endpoint for this listing, or null when the stored
 * company or offer isn't a plain subdomain and slug (so nothing else can be
 * reached through it).
 */
export function recruiteeEndpoint(recruitee: NormalizedJob['recruitee'] | undefined): string | null {
  if (!recruitee || !SUBDOMAIN.test(recruitee.company) || !SLUG.test(recruitee.offer)) return null;
  return `https://${recruitee.company.toLowerCase()}.recruitee.com/api/offers/${encodeURIComponent(recruitee.offer)}/candidates`;
}

/** "Re: <subject>", once. */
export function replySubject(subject: string): string {
  const clean = oneLine(subject, 200);
  if (!clean) return 'Re: your message';
  return /^re:/i.test(clean) ? clean : `Re: ${clean}`;
}

/** The References chain for a reply: the earlier chain plus the message answered, each id once. */
export function replyReferences(references: string, messageId: string): string {
  const ids = `${references} ${messageId}`.split(/\s+/).filter((id) => /^<[^<>\s]+>$/.test(id));
  return [...new Set(ids)].join(' ');
}

/** The day `days` after an ISO day ('YYYY-MM-DD'). */
export function addDays(day: string, days: number): string {
  const time = Date.parse(`${day.slice(0, 10)}T00:00:00Z`) + days * 86_400_000;
  return new Date(time).toISOString().slice(0, 10);
}

// ─── Paste kit ──────────────────────────────────────────────────────────

/** "INR 30,00,000 per year", grouped the way the currency is usually written. */
export function formatMoney(money: Money): string {
  const locale = money.currency === 'INR' ? 'en-IN' : 'en-US';
  return `${money.currency} ${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(money.amount)} per ${money.period}`;
}

function noticeText(days: number): string {
  if (days <= 0) return 'Immediately available';
  return days === 1 ? '1 day' : `${days} days`;
}

const ASKS_SALARY = /salary|ctc|compensation|pay\b/i;
const ASKS_NOTICE = /notice|join|start date|availab/i;

export type PasteField = { label: string; value: string };

/**
 * Every field a link apply asks for, in the order forms usually ask: who, how
 * to reach them, their links, the note, each screening answer, then salary and
 * notice. Empty fields are left out. Salary and notice come from the spec only
 * when no screening answer already covers them.
 */
export function buildPasteKit(input: {
  profile: Pick<CareerProfile, 'contact'> | null;
  application: Pick<CareerApplication, 'coverNote' | 'answers'> | null;
  spec: Pick<CareerSpec, 'salaryTarget' | 'salaryFloor' | 'noticeDays'> | null;
}): PasteField[] {
  const fields: PasteField[] = [];
  const add = (label: string, value: string | null | undefined) => {
    const clean = value?.trim();
    if (clean) fields.push({ label, value: clean });
  };
  const contact = input.profile?.contact;
  if (contact) {
    add('Full name', contact.name);
    add('Email', contact.email);
    add('Phone', contact.phone);
    add('Location', contact.location);
    const linkedIn = contact.links.find((link) => isLinkedIn(link.url));
    add('LinkedIn', linkedIn?.url);
    for (const link of contact.links) {
      if (link !== linkedIn) add(link.label.trim() || 'Link', link.url);
    }
  }
  const answers = input.application?.answers ?? [];
  add('Cover note', input.application?.coverNote?.text);
  for (const answer of answers) add(oneLine(answer.question, 200), answer.answer);
  const spec = input.spec;
  const salary = spec?.salaryTarget ?? spec?.salaryFloor ?? null;
  if (salary && !answers.some((answer) => ASKS_SALARY.test(answer.question))) add('Expected salary', formatMoney(salary));
  if (spec && spec.noticeDays !== null && !answers.some((answer) => ASKS_NOTICE.test(answer.question))) add('Notice period', noticeText(spec.noticeDays));
  return fields;
}
