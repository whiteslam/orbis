/**
 * The Gmail watcher's small pure decisions: what to search for, how a reply
 * becomes an event, and which applications mail is matched against.
 */
import { ALERT_SENDERS } from './alerts.ts';
import type { OpenApp } from './mail.ts';
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

/** Open applications as the reply matcher sees them: the company, its mail domains and the thread Orbis sent in. */
export function openAppsFrom(
  applications: ReadonlyArray<Pick<CareerApplication, 'id' | 'jobId' | 'companyDomains' | 'gmailThreadId'>>,
  jobsById: ReadonlyMap<string, Pick<CareerJob, 'company'>>,
): OpenApp[] {
  return applications.flatMap((app) => {
    const job = jobsById.get(app.jobId);
    return job ? [{ id: app.id, company: job.company, domains: app.companyDomains, threadId: app.gmailThreadId }] : [];
  });
}

/** What an event keeps about the email: enough to show and to act on, never the body. */
export function replyDetails(input: { from: string; subject: string; classification: ReplyClassification | null; reason: string }): Record<string, unknown> {
  const details: Record<string, unknown> = { from: input.from.slice(0, 300), subject: input.subject.slice(0, 300), matchedBy: input.reason };
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

/** A prep pack with only the logistics, for when no model could write the rest: the time still shows. */
export function logisticsOnlyPrep(logistics: InterviewPrep['logistics']): InterviewPrep {
  return { logistics, likelyTopics: [], questionsToAsk: [], gaps: [] };
}

/** The ghosting note on the timeline. */
export function ghostedSummary(days: number): string {
  return `No reply in ${days} days, so it’s marked ghosted. A reply will bring it back.`;
}
