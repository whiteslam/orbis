// What to do next with a publication still processing. Pure, because this is
// the one place a mistake posts something twice.
//
// The rule that matters: once Orbis has sent the publish call (`sentAt`), an
// unclear outcome is never dropped. Dropping re-enables Publish, and the post
// may already be live. Such a row stays until Meta says PUBLISHED (recover it),
// or says FINISHED, ERROR or EXPIRED well after the call: a container that went
// out reads PUBLISHED, so those mean it did not.

export type PublishStep = 'wait' | 'publish' | 'recover' | 'keep' | 'drop';

const NO_CONTAINER_GRACE_MS = 2 * 60_000;
const RESEND_AFTER_MS = 60_000;
const UNSENT_MAX_AGE_MS = 24 * 60 * 60_000;
const SENT_SETTLE_MS = 10 * 60_000;

export function publishDecision(row: { containerId: string | null; sentAt: string | null; createdAt: string }, status: string | null, now: Date): PublishStep {
  const age = now.getTime() - new Date(row.createdAt).getTime();
  // Another request may be creating the container this very moment.
  if (!row.containerId) return age > NO_CONTAINER_GRACE_MS ? 'drop' : 'wait';
  if (status === 'PUBLISHED') return 'recover';
  if (row.sentAt) {
    const sinceSent = now.getTime() - new Date(row.sentAt).getTime();
    if (status === 'FINISHED') return sinceSent > RESEND_AFTER_MS ? 'publish' : 'wait';
    if ((status === 'ERROR' || status === 'EXPIRED') && sinceSent > SENT_SETTLE_MS) return 'drop';
    return 'keep';
  }
  if (age > UNSENT_MAX_AGE_MS) return 'drop';
  if (status === 'FINISHED') return 'publish';
  if (status === 'IN_PROGRESS') return 'wait';
  return 'drop';
}
