import { localClock } from '@/lib/notifications/schedule';
import type { Finding, HeadsupKind } from '@/lib/headsups/types';

export const SCAN_FROM_MINUTES = 6 * 60;
export const DISMISS_HOLD_DAYS = 30;
export const KEEP_DAYS = 60;
export const AI_WORDED_PER_DAY = 10;
const DAY_MS = 86_400_000;

export function localNow(now: Date, timeZone: string) {
  try {
    return localClock(now, timeZone);
  } catch {
    return localClock(now, 'Asia/Kolkata');
  }
}

export function dueForScan(people: Array<{ userId: string; timeZone: string; lastScanDate: string | null }>, now: Date) {
  return people.flatMap(({ userId, timeZone, lastScanDate }) => {
    const clock = localNow(now, timeZone);
    if (clock.minutes < SCAN_FROM_MINUTES) return [];
    if (lastScanDate && lastScanDate >= clock.date) return [];
    return [{ userId, localDate: clock.date, timeZone }];
  });
}

export function mergeAction(existing: { status: 'new' | 'seen' | 'done' | 'dismissed'; updatedAt: string } | null, now: Date) {
  if (!existing) return 'insert' as const;
  if (existing.status === 'new' || existing.status === 'seen') return 'refresh' as const;
  if (existing.status === 'done') return 'skip' as const;
  const held = now.getTime() - new Date(existing.updatedAt).getTime() < DISMISS_HOLD_DAYS * DAY_MS;
  return held ? 'skip' as const : 'revive' as const;
}

export function runChecks(checks: Array<{ kind: HeadsupKind; run: () => Finding[] }>, disabled: string[]) {
  const findings: Finding[] = [];
  const failed: HeadsupKind[] = [];
  for (const check of checks) {
    if (disabled.includes(check.kind)) continue;
    try {
      findings.push(...check.run());
    } catch (error) {
      console.error(`Heads-up check ${check.kind} failed`, error);
      failed.push(check.kind);
    }
  }
  return { findings, failed };
}

export function pruneBefore(now: Date) {
  return new Date(now.getTime() - KEEP_DAYS * DAY_MS).toISOString();
}

/**
 * Open heads-ups (new or seen) that a check which ran cleanly no longer finds:
 * the routine was archived, the steps recovered. They are withdrawn rather than
 * left on Today until someone dismisses something that is no longer true.
 */
export function staleIds(open: Array<{ id: string; kind: HeadsupKind; dedupeKey: string }>, findings: Finding[], ranKinds: HeadsupKind[]) {
  const found = new Set(findings.map((finding) => finding.dedupeKey));
  return open.filter((row) => ranKinds.includes(row.kind) && !found.has(row.dedupeKey)).map((row) => row.id);
}
