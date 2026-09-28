import type { HealthPlanRecord } from '@/lib/health-docs/types';

/**
 * Where a plan stands, counted from the day it was written. Plans have no
 * separate start date, so creation is the only honest anchor.
 */
export function planWeek(record: HealthPlanRecord) {
  const total = Math.max(1, record.plan.durationWeeks);
  const elapsed = Math.floor((Date.now() - new Date(record.createdAt).getTime()) / (7 * 86_400_000)) + 1;
  return { week: Math.min(Math.max(elapsed, 1), total), total, done: elapsed > total };
}
