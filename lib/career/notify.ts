/**
 * The heads-ups Career raises, worded by rules. Pure.
 *
 * Only what is waiting on the owner earns one (the design's "Noise" anti-goal):
 * an interview invite, an offer, a recruiter's question, and a follow-up ready
 * to send. How loud each is lives in lib/headsups/types.ts, never here.
 */
import { URGENCY, type HeadsupAction, type Evidence } from '../headsups/types.ts';
import type { ReplyKind } from './types.ts';

export type CareerHeadsupKind = 'career.interview' | 'career.offer' | 'career.question' | 'career.follow_up';

/** The kinds a reply raises; a follow-up comes from the clock, not from mail. */
export type ReplyHeadsupKind = Exclude<CareerHeadsupKind, 'career.follow_up'>;

export type CareerHeadsup = {
  kind: CareerHeadsupKind;
  dedupeKey: string;
  urgency: 'normal' | 'urgent';
  title: string;
  body: string;
  actionLabel: string;
  action: HeadsupAction;
  evidence: Evidence;
};

/** The heads-up a classified reply raises, if any. */
export function headsupKindFor(kind: ReplyKind): ReplyHeadsupKind | null {
  if (kind === 'interview_invite') return 'career.interview';
  if (kind === 'offer') return 'career.offer';
  if (kind === 'recruiter_question') return 'career.question';
  return null;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LOCAL_ISO = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/;

/**
 * "Tue 3 Nov, 15:30" from a local ISO time (the prep pack's logistics.at,
 * already in the owner's zone). The same on every machine: no locale.
 */
export function whenText(localIso: string | null): string | null {
  const match = localIso ? LOCAL_ISO.exec(localIso) : null;
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  const weekday = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))).getUTCDay();
  return `${DAYS[weekday]} ${Number(day)} ${MONTHS[Number(month) - 1] ?? ''}, ${hour}:${minute}`;
}

/** Cut to `max` characters on a word boundary, with an ellipsis when cut. */
export function fit(text: string, max: number): string {
  const flat = text.replaceAll(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

export type ReplyHeadsupInput = {
  kind: ReplyHeadsupKind;
  applicationId: string;
  messageId: string;
  company: string;
  role: string;
  /** The classifier's one-line summary of the email. */
  summary: string;
  /** For an interview: the local ISO time, when the invite gave one. */
  at?: string | null;
};

function replyWording(input: ReplyHeadsupInput) {
  const when = whenText(input.at ?? null);
  switch (input.kind) {
    case 'career.interview':
      return {
        title: when ? `Interview with ${input.company}, ${when}` : `${input.company} wants to interview you`,
        actionLabel: 'Open prep',
      };
    case 'career.offer':
      return { title: `Offer from ${input.company}`, actionLabel: 'Review offer' };
    default:
      return { title: `${input.company} asked you something`, actionLabel: 'Open application' };
  }
}

/** One heads-up per message: the dedupe key is the Gmail message id, so a re-run never doubles it. */
export function replyHeadsup(input: ReplyHeadsupInput): CareerHeadsup {
  const wording = replyWording(input);
  return {
    kind: input.kind,
    dedupeKey: fit(`${input.kind}:${input.messageId}`, 200),
    urgency: URGENCY[input.kind],
    title: fit(wording.title, 80),
    body: fit(`${input.role}: ${input.summary}`, 300),
    actionLabel: wording.actionLabel,
    action: { type: 'open_career_application', applicationId: input.applicationId },
    evidence: { company: fit(input.company, 120), role: fit(input.role, 120), messageId: input.messageId },
  };
}

/** A follow-up ready for an application with no reply; one per application per day it was drafted. */
export function followUpHeadsup(input: { applicationId: string; company: string; role: string; day: string }): CareerHeadsup {
  return {
    kind: 'career.follow_up',
    dedupeKey: `career.follow_up:${input.applicationId}:${input.day}`,
    urgency: URGENCY['career.follow_up'],
    title: fit(`Follow up with ${input.company}?`, 80),
    body: fit(`No reply yet on ${input.role}. A short follow-up is ready; it goes only when you press Send.`, 300),
    actionLabel: 'Review follow-up',
    action: { type: 'open_career_application', applicationId: input.applicationId },
    evidence: { company: fit(input.company, 120), role: fit(input.role, 120) },
  };
}
