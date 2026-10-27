/**
 * The Gmail watcher's small pure decisions: what to search for, how a reply
 * becomes an event, and which applications mail is matched against.
 */
import { ALERT_SENDERS } from './alerts.ts';
import { applyEmailFor } from './draft-plan.ts';
import type { OpenApp } from './mail.ts';
import { trustedCompanyDomains } from './recipient.ts';
import type { CareerApplication, CareerJob, EventKind, InterviewPrep, ReplyClassification, ReplyKind } from './types.ts';

/**
 * Mail that might be a reply: the last three days, not sent by the owner, not
 * chat, promotions or social, and not from the job-alert senders (the alert
 * pass reads those). Everything it finds is judged on headers and snippet
 * before any body is read.
 */
export function replyGmailQuery(): string {
  const alertAddresses = ALERT_SENDERS.flatMap((sender) => sender.patterns).filter((pattern) => pattern.includes('@'));
  return [
    'newer_than:3d', '-from:me', '-in:chats', '-in:drafts', '-in:spam', '-in:trash', '-category:promotions', '-category:social',
    `-from:(${alertAddresses.join(' OR ')})`,
  ].join(' ');
}

const EVENT_FOR: Record<ReplyKind, EventKind> = {
  acknowledgement: 'acknowledgement',
  rejection: 'rejection',
  interview_invite: 'interview_invite',
  assessment: 'assessment',
  recruiter_question: 'recruiter_question',
  offer: 'offer',
  other: 'reply',
};

/** The timeline event a classified reply records. */
export function eventKindFor(kind: ReplyKind): EventKind {
  return EVENT_FOR[kind];
}

/**
 * Open applications as the reply matcher sees them: the company, the thread
 * Orbis sent in, and the mail domains worked out afresh from the job (so an
 * application drafted before the trust rules in lib/career/recipient.ts is
 * held to them too).
 */
export function openAppsFrom(
  applications: ReadonlyArray<Pick<CareerApplication, 'id' | 'jobId' | 'gmailThreadId'>>,
  jobsById: ReadonlyMap<string, Pick<CareerJob, 'company' | 'source' | 'url' | 'applyUrl' | 'applyEmail' | 'description' | 'seenOn' | 'requirements'>>,
): OpenApp[] {
  return applications.flatMap((app) => {
    const job = jobsById.get(app.jobId);
    if (!job) return [];
    const domains = trustedCompanyDomains(job, applyEmailFor(job, job.requirements));
    return [{ id: app.id, company: job.company, domains, threadId: app.gmailThreadId }];
  });
}

/** What an event keeps about the email: enough to show and to act on, never the body. */
export function replyDetails(input: {
  from: string;
  subject: string;
  classification: ReplyClassification | null;
  reason: string;
  threadId?: string;
  /** Gmail's short preview, for a reply recorded without reading it. */
  snippet?: string;
  /** The application its company name suggests, for the owner to confirm. */
  suggestedApplicationId?: string | null;
}): Record<string, unknown> {
  const details: Record<string, unknown> = { from: input.from.slice(0, 300), subject: input.subject.slice(0, 300), matchedBy: input.reason };
  if (input.threadId) details.threadId = input.threadId.slice(0, 100);
  if (input.snippet) details.snippet = input.snippet.slice(0, 300);
  if (input.suggestedApplicationId) details.suggestedApplicationId = input.suggestedApplicationId;
  const classification = input.classification;
  if (!classification) return { ...details, classified: false };
  return {
    ...details,
    company: classification.company,
    role: classification.role,
    interviewAt: classification.interviewAt,
    interviewFormat: classification.interviewFormat,
    meetingLink: classification.meetingLink,
    needsReply: classification.needsReply,
  };
}

/**
 * The search reads three days back. A reply the model couldn't classify (AI
 * off, credits spent, no model answered) is left for the next run while it is
 * younger than this, then recorded unclassified so it isn't lost when it ages
 * out of the search.
 */
export const CLASSIFY_RETRY_MS = 60 * 3_600_000;

/** Whether an unclassified reply should wait for another try instead of being recorded now. */
export function retryClassification(receivedAt: string, now: Date): boolean {
  const age = now.getTime() - Date.parse(receivedAt);
  return Number.isFinite(age) && age < CLASSIFY_RETRY_MS;
}

/** A prep pack with only the logistics, for when no model could write the rest: the time still shows. */
export function logisticsOnlyPrep(logistics: InterviewPrep['logistics']): InterviewPrep {
  return { logistics, likelyTopics: [], questionsToAsk: [], gaps: [] };
}

/** The ghosting note on the timeline. */
export function ghostedSummary(days: number): string {
  return `No reply in ${days} days, so it’s marked ghosted. A reply will bring it back.`;
}
