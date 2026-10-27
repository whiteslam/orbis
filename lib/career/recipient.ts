/**
 * Who Orbis is about to write to, and how far it trusts whoever said so.
 * Pure and client-safe: the Send bar, the offer reply, the job merge and the
 * Gmail watcher all ask the same questions here.
 *
 * Source trust, highest first. Contact details (an apply address, an apply
 * page) are only ever taken from the listing a job was first stored from, and
 * a lower-trust source never says which company a mail domain belongs to:
 *   3 — the company's own ATS board (Greenhouse, Lever, Ashby, Recruitee) and
 *       jobs the owner pasted: the company, or the owner, wrote them;
 *   2 — remote job boards (Himalayas, Remotive, Remote OK, We Work Remotely,
 *       Jobspresso, Adzuna): moderated, but anyone can buy a post;
 *   1 — Hacker News comments and job-alert emails: anyone can post a comment,
 *       and an alert is read by AI from an email.
 */
import { applyEmailFor } from './draft-plan.ts';
import { linkHost } from './links.ts';
import { baseDomain, companyDomains, domainOf, isNonCompanyDomain } from './mail.ts';
import type { ApplyRoute, CareerEvent, CareerJob, NormalizedJob, SourceId } from './types.ts';
import { senderAddress } from '../gmail/important-filter.ts';

export type Trust = 1 | 2 | 3;

export const SOURCE_TRUST: Readonly<Record<SourceId, Trust>> = {
  greenhouse: 3, lever: 3, ashby: 3, recruitee: 3, pasted: 3,
  himalayas: 2, remotive: 2, remoteok: 2, wwr: 2, jobspresso: 2, adzuna: 2,
  hn: 1, gmail_alerts: 1,
};

/** Hacker News or a job-alert email: what it says about a company isn't evidence. */
export const isLowTrust = (source: SourceId) => SOURCE_TRUST[source] === 1;

// ─── Merging a new sighting ──────────────────────────────────────────────

/** A stored job as the merge sees it. */
export type StoredListing = {
  source: SourceId | null;
  url: string | null;
  thin: boolean;
  description: string | null;
  applyEmail: string | null;
  applyUrl: string | null;
};

export type ListingPatch = { description?: string | null; thin?: boolean; applyEmail?: string; applyUrl?: string };

/** The same listing seen again: same source, same page. */
export function sameListing(incoming: Pick<NormalizedJob, 'source' | 'url'>, stored: Pick<StoredListing, 'source' | 'url'>): boolean {
  return incoming.source === stored.source && incoming.url === stored.url;
}

/** True when `incoming` says more about the job than what is stored. */
function isRicher(incoming: Pick<NormalizedJob, 'thin' | 'description'>, stored: Pick<StoredListing, 'thin' | 'description'>) {
  if (incoming.thin && !stored.thin) return false;
  if (!incoming.thin && stored.thin) return Boolean(incoming.description);
  return (incoming.description?.length ?? 0) > (stored.description?.length ?? 0);
}

/**
 * What a new sighting of a stored job may change beyond its list of sightings.
 * Two listings share a dedupe key when company, title and location match, and
 * anyone can post a Hacker News comment that matches; so:
 * - the apply address and apply page come only from the listing stored first
 *   (seen again, it may fill what it lacked), never from another listing;
 * - a richer description comes from that listing, or from a more trusted
 *   source (an owner's paste fills in an alert's one line).
 */
export function listingPatch(incoming: NormalizedJob, stored: StoredListing): ListingPatch {
  const same = sameListing(incoming, stored);
  const patch: ListingPatch = {};
  const moreTrusted = stored.source !== null && SOURCE_TRUST[incoming.source] > SOURCE_TRUST[stored.source];
  if ((same || moreTrusted) && isRicher(incoming, stored)) {
    patch.description = incoming.description?.slice(0, 20_000) ?? null;
    patch.thin = incoming.thin;
  }
  if (!same) return patch;
  if (!stored.applyEmail && incoming.applyEmail) patch.applyEmail = incoming.applyEmail.slice(0, 320);
  if (!stored.applyUrl && incoming.applyUrl) patch.applyUrl = incoming.applyUrl;
  return patch;
}

// ─── Company domains ─────────────────────────────────────────────────────

type JobUrls = Pick<CareerJob, 'source' | 'url' | 'applyUrl' | 'seenOn'>;

/**
 * Whether a sighting's page may say where the company's mail comes from: not
 * from a low-trust source, and not from one less trusted than the listing the
 * job was stored from. Anyone can post a Hacker News comment or mail a "job
 * alert" that shares a stored job's dedupe key and links their own site.
 */
function sightingNamesDomain(job: Pick<CareerJob, 'source'>, seen: CareerJob['seenOn'][number]) {
  return !isLowTrust(seen.source) && SOURCE_TRUST[seen.source] >= SOURCE_TRUST[job.source];
}

/**
 * The company's domains as its listing pages show them (boards, ATSs and free
 * mail excluded). A job first stored from a low-trust source keeps that
 * listing's pages even after a trusted listing merges in, so its own pages
 * name no domain; only trusted sightings do.
 */
export function knownCompanyDomains(job: JobUrls): string[] {
  const own = isLowTrust(job.source) ? [] : [job.url, job.applyUrl];
  const sightings = job.seenOn.filter((seen) => sightingNamesDomain(job, seen)).map((seen) => seen.url);
  return companyDomains({ applyEmail: null, urls: [...own, ...sightings] });
}

/**
 * The domains mail from this company may come from: its listing pages', plus
 * the apply address's, unless that address came from a low-trust source and
 * matches none of them. A domain here links replies to the application and
 * lets them move it, so a stranger's address must not get in.
 */
export function trustedCompanyDomains(job: JobUrls & Pick<CareerJob, 'source'>, applyEmail: string | null): string[] {
  const known = knownCompanyDomains(job);
  const domain = applyEmail ? domainOf(applyEmail) : null;
  if (!domain || isNonCompanyDomain(domain)) return known;
  const base = baseDomain(domain);
  if (known.includes(base) || isLowTrust(job.source)) return known;
  return [base, ...known];
}

/** Whether `address` is at one of `domains` (each a base domain). */
export function addressAtDomains(address: string, domains: readonly string[]): boolean {
  const domain = domainOf(address);
  if (!domain || isNonCompanyDomain(domain)) return false;
  return domains.includes(baseDomain(domain));
}

// ─── Where Send goes ─────────────────────────────────────────────────────

export type SendRecipient =
  | {
    kind: 'email';
    address: string;
    /** Where the address came from: the stored listing's source. */
    source: SourceId;
    /** The address's domain is one the company's own pages use. */
    domainMatches: boolean;
    /** No earlier application went to this address (or its company domain): Send asks first. */
    firstTime: boolean;
  }
  | { kind: 'recruitee'; company: string }
  | { kind: 'link'; host: string | null };

/**
 * What counts as "the same recipient" for the first-use check: the company
 * domain, or the whole address at a free-mail or ATS domain (anyone can have
 * a gmail.com address). An ambiguous header is only ever the same as itself.
 */
export function recipientKey(address: string): string {
  const mailbox = senderAddress(address);
  if (mailbox === null) return address.trim().toLowerCase();
  const domain = domainOf(mailbox);
  if (!domain || isNonCompanyDomain(domain)) return mailbox;
  return baseDomain(domain);
}

/** Whether no address in `used` shares `address`'s recipient key. */
export function isFirstRecipient(address: string, used: readonly string[]): boolean {
  const key = recipientKey(address);
  return !used.some((item) => recipientKey(item) === key);
}

type RecipientJob = Pick<CareerJob, 'source' | 'company' | 'url' | 'applyUrl' | 'applyEmail' | 'description' | 'seenOn' | 'requirements'>;

/**
 * Where Send will deliver this application, exactly: the address for the
 * email route (with what's known about it), Recruitee's careers page, or the
 * apply page's host. `usedAddresses` are the addresses earlier applications
 * went to.
 */
export function applyRecipient(job: RecipientJob, route: ApplyRoute, usedAddresses: readonly string[]): SendRecipient {
  const listed = route === 'email' ? applyEmailFor(job, job.requirements) : null;
  // An address that doesn't read as one mailbox is no address to send to.
  const address = listed ? senderAddress(listed) : null;
  if (address) {
    return {
      kind: 'email',
      address,
      source: job.source,
      domainMatches: addressAtDomains(address, knownCompanyDomains(job)),
      firstTime: isFirstRecipient(address, usedAddresses),
    };
  }
  if (route === 'recruitee') return { kind: 'recruitee', company: job.company };
  return { kind: 'link', host: linkHost(job.applyUrl ?? job.url) };
}

/** The recipient in a few words: "jobs@acme.io", "Recruitee careers page of Acme", "the apply page on acme.io". */
export function recipientText(recipient: SendRecipient): string {
  if (recipient.kind === 'email') return recipient.address;
  if (recipient.kind === 'recruitee') return `Recruitee careers page of ${recipient.company}`;
  return recipient.host ? `the apply page on ${recipient.host}` : 'the apply page';
}

// ─── Where an offer reply goes ───────────────────────────────────────────

export type ReplyTarget = {
  to: string;
  /** The Gmail message being answered, for its thread headers. */
  gmailId: string | null;
  threadId: string | null;
  via: 'offer' | 'sent';
  /** False: the offer email couldn't be tied to the company; the owner should check the address. */
  verified: boolean;
};

const str = (value: unknown) => (typeof value === 'string' && value ? value : null);

/** The newest message Orbis sent for the application: its Gmail id and where it went. */
export function lastSentMessage(events: readonly CareerEvent[]): { gmailId: string; to: string | null; subject: string | null } | null {
  for (const event of events) {
    if (event.kind !== 'sent' && event.kind !== 'follow_up_sent' && !(event.kind === 'note' && event.details.kind === 'offer_reply')) continue;
    const gmailId = str(event.details.gmailId);
    if (gmailId) return { gmailId, to: str(event.details.to), subject: str(event.details.subject) };
  }
  return null;
}

/** An offer email that is provably the company's: in the thread Orbis sent, or from its domain. */
function offerIsTrusted(event: CareerEvent, appThreadId: string | null, trustedDomains: readonly string[], from: string) {
  const threadId = str(event.details.threadId);
  if (appThreadId && threadId === appThreadId) return true;
  if (appThreadId && !threadId && event.details.matchedBy === 'thread') return true;
  return addressAtDomains(from, trustedDomains);
}

/**
 * Who an offer reply goes to. A reply about money must not go to whoever
 * claimed to be the company, so, in order:
 * - the offer email's sender, when that email is in the thread Orbis sent or
 *   from one of the company's domains;
 * - otherwise the person Orbis applied to, in the thread it sent;
 * - otherwise the offer email's sender, flagged unverified (an offer the owner
 *   attached by hand), so the screen can say to check the address.
 * `events` are newest first.
 */
export function offerReplyTarget(input: { events: readonly CareerEvent[]; appThreadId: string | null; trustedDomains: readonly string[] }): ReplyTarget | null {
  const offer = input.events.find((event) => event.kind === 'offer' && event.gmailMessageId && str(event.details.from));
  const from = offer ? senderAddress(String(offer.details.from)) : null;
  const fromOffer = (verified: boolean): ReplyTarget | null => (offer && from
    ? { to: from, gmailId: offer.gmailMessageId, threadId: str(offer.details.threadId), via: 'offer', verified }
    : null);
  if (offer && from && offerIsTrusted(offer, input.appThreadId, input.trustedDomains, from)) return fromOffer(true);
  const sent = lastSentMessage(input.events);
  const sentTo = sent?.to ? senderAddress(sent.to) : null;
  if (sent && sentTo && input.appThreadId) return { to: sentTo, gmailId: sent.gmailId, threadId: input.appThreadId, via: 'sent', verified: true };
  return fromOffer(false);
}
