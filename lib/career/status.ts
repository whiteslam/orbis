/**
 * The application state machine. Pure and client-safe.
 *
 * Who may move an application where, per the design ("Gmail watcher",
 * "Follow-ups and ghosting", the Pipeline board):
 * - mail only moves forward along sent < acknowledged < replied < assessment <
 *   interview < offer, may reject anything before an offer, and revives a
 *   ghosted application;
 * - the system drafts, sends and ghosts;
 * - the owner applies by hand, withdraws, accepts, declines, and records what
 *   Gmail can't see (a phone call that booked an interview).
 */
import { APPLICATION_STATUSES } from './types.ts';
import type { ApplicationStatus, ReplyKind } from './types.ts';

export type Mover = 'owner' | 'mail' | 'system';

export const STAGE_ORDER = ['sent', 'acknowledged', 'replied', 'assessment', 'interview', 'offer'] as const satisfies readonly ApplicationStatus[];

export type StageGroupId = 'ready' | 'sent' | 'replied' | 'interview' | 'offer' | 'closed';

/** The UI columns, in board order. Every status sits in exactly one. */
export const STAGE_GROUPS: ReadonlyArray<{ id: StageGroupId; label: string; statuses: readonly ApplicationStatus[] }> = [
  { id: 'ready', label: 'Ready', statuses: ['drafting', 'ready', 'sending', 'opened'] },
  { id: 'sent', label: 'Sent', statuses: ['sent', 'acknowledged'] },
  { id: 'replied', label: 'Replied', statuses: ['replied', 'assessment'] },
  { id: 'interview', label: 'Interview', statuses: ['interview'] },
  { id: 'offer', label: 'Offer', statuses: ['offer'] },
  { id: 'closed', label: 'Closed', statuses: ['accepted', 'declined', 'rejected', 'withdrawn', 'ghosted', 'failed'] },
];

/** The column a status belongs to. */
export function groupOf(status: ApplicationStatus): StageGroupId {
  return STAGE_GROUPS.find((group) => group.statuses.includes(status))?.id ?? 'closed';
}

/** Position on the forward ladder, or -1 for statuses off it (drafts, closed ones). */
export function stageRank(status: ApplicationStatus): number {
  return (STAGE_ORDER as readonly ApplicationStatus[]).indexOf(status);
}

/** Sent and still in play: a reply can still change it. */
export function isOpen(status: ApplicationStatus): boolean {
  return stageRank(status) >= 0;
}

/**
 * Worth matching incoming mail against: open, or ghosted (a late reply revives
 * it, so the watcher must still recognise the company).
 */
export function isWatched(status: ApplicationStatus): boolean {
  return isOpen(status) || status === 'ghosted';
}

/**
 * Whether a person (or their ATS) answered at some point: replied or further,
 * or closed by an answer. A rejection is a reply; an auto-acknowledgement isn't.
 */
export function hadReply(status: ApplicationStatus): boolean {
  return stageRank(status) >= stageRank('replied') || status === 'accepted' || status === 'declined' || status === 'rejected';
}

const TERMINAL: readonly ApplicationStatus[] =['accepted', 'declined', 'withdrawn'];

function mailMay(from: ApplicationStatus, to: ApplicationStatus): boolean {
  const fromRank = stageRank(from);
  const toRank = stageRank(to);
  if (to === 'rejected') return (fromRank >= 0 && fromRank < stageRank('offer')) || from === 'ghosted';
  if (toRank < 0) return false;
  // A reply of any kind revives a ghosted application; "sent" isn't a reply.
  if (from === 'ghosted') return toRank > 0;
  return fromRank >= 0 && toRank > fromRank;
}

const SYSTEM_MOVES: Partial<Record<ApplicationStatus, readonly ApplicationStatus[]>> = {
  drafting: ['ready', 'failed'],
  ready: ['sending'],
  // A Recruitee post that fails falls back to the link route, which waits in `opened`.
  sending: ['sent', 'failed', 'opened', 'ready'],
  // Ghosting needs no reply of substance; an auto-acknowledgement isn't one.
  sent: ['ghosted'],
  acknowledged: ['ghosted'],
};

function systemMay(from: ApplicationStatus, to: ApplicationStatus): boolean {
  return SYSTEM_MOVES[from]?.includes(to) ?? false;
}

const OWNER_PREP_MOVES: Partial<Record<ApplicationStatus, readonly ApplicationStatus[]>> = {
  // Send itself is the owner's press, carried out by the server action.
  ready: ['sending', 'opened', 'drafting'],
  // "I applied" on the link route.
  opened: ['sent', 'ready'],
  failed: ['ready', 'drafting'],
};

function ownerMay(from: ApplicationStatus, to: ApplicationStatus): boolean {
  if (TERMINAL.includes(from) || from === 'sending') return false;
  if (to === 'withdrawn') return true;
  if (to === 'accepted' || to === 'declined') return from === 'offer';
  if (OWNER_PREP_MOVES[from]?.includes(to)) return true;
  const toRank = stageRank(to);
  // Forward moves Gmail can't see (a phone screen, an offer by call). "sent"
  // is reached only through Send or "I applied", never by dragging.
  if (toRank > 0 && (isOpen(from) || from === 'ghosted' || from === 'rejected')) {
    // From rejected or ghosted this is the owner correcting the record.
    return from === 'rejected' || from === 'ghosted' || toRank > stageRank(from);
  }
  return to === 'rejected' && (isOpen(from) || from === 'ghosted');
}

/** Whether `by` may move an application from `from` to `to`. Staying put is never a move. */
export function canTransition(from: ApplicationStatus, to: ApplicationStatus, by: Mover): boolean {
  if (from === to) return false;
  if (by === 'mail') return mailMay(from, to);
  if (by === 'system') return systemMay(from, to);
  return ownerMay(from, to);
}

const REPLY_TARGET: Record<ReplyKind, ApplicationStatus | null> = {
  acknowledgement: 'acknowledged',
  rejection: 'rejected',
  interview_invite: 'interview',
  assessment: 'assessment',
  recruiter_question: 'replied',
  offer: 'offer',
  // Too vague to move a card; the event is still recorded on the timeline.
  other: null,
};

/** Where a classified reply moves the application, or null when it shouldn't move. */
export function statusFromReply(current: ApplicationStatus, kind: ReplyKind): ApplicationStatus | null {
  const target = REPLY_TARGET[kind];
  if (!target) return null;
  return canTransition(current, target, 'mail') ? target : null;
}

/** What the kanban drop zones and the card menu may offer the owner. */
export function ownerMoves(current: ApplicationStatus): ApplicationStatus[] {
  return APPLICATION_STATUSES.filter((to) => canTransition(current, to, 'owner'));
}
