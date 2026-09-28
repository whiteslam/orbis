import { SOCIAL_STATUS_LABEL, type SocialStatus } from '@/lib/social/types';

/** The one place status colours live. Always prints the word, never colour alone. */
export function StatusChip({ status }: { status: SocialStatus }) {
  return <span className={`so-status so-status-${status}`}>{SOCIAL_STATUS_LABEL[status]}</span>;
}
