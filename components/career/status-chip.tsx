import { STATUS_LABEL } from '@/components/career/format';
import { groupOf } from '@/lib/career/status';
import type { ApplicationStatus } from '@/lib/career/types';

/**
 * An application's status. The colour comes from its stage (Ready blue, Sent
 * teal, Replied violet, Interview green, Offer the gradient, Closed grey) and
 * only reinforces the word, which is always printed.
 */
export function StatusChip({ status }: Readonly<{ status: ApplicationStatus }>) {
  return (
    <span className={`cr-chip cr-stage-${groupOf(status)} cr-status-${status}`}>
      <i aria-hidden="true" />
      {STATUS_LABEL[status]}
    </span>
  );
}
