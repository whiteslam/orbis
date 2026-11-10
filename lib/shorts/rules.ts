// The Shorts rules the server actions and the screens share: what a topic and
// the options may be, which status allows which action, the queue limits and
// whether the PC worker is there. Pure and client-safe.

import type { JobStatus, ShortEvent, ShortJob, ShortOptions, ShortStyle, WorkerPresence, WorkerState } from '@/lib/shorts/types';

export const LIMITS = { inFlight: 3, perMonth: 30, topic: 300, endLine: 80, feedback: 1000 } as const;

/** Statuses the worker still has to act on, or the owner has to answer. */
export const IN_FLIGHT: readonly JobStatus[] = ['queued', 'planning', 'plan_ready', 'building'];
const WORKING: readonly JobStatus[] = ['queued', 'planning', 'building'];

/** After this long without a heartbeat the worker is shown as offline. */
export const OFFLINE_AFTER_MS = 120_000;

const VOICE = /^[a-z]{2}_[a-z]+$/;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/g;

/** One line of plain text: control characters dropped, whitespace collapsed. */
export function oneLine(raw: unknown, max: number): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** The topic as the worker will receive it, or null when empty or too long. */
export function cleanTopic(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const topic = raw.replace(CONTROL, '').replace(/\s+/g, ' ').trim();
  return topic && topic.length <= LIMITS.topic ? topic : null;
}

/** The intake options, with every field forced into its allowed range. */
export function readOptions(raw: unknown, style: Pick<ShortStyle, 'secondsMin' | 'secondsMax' | 'defaultVoice'>): ShortOptions | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const input = raw as Record<string, unknown>;
  const middle = Math.round((style.secondsMin + style.secondsMax) / 2);
  const asked = typeof input.seconds === 'number' && Number.isFinite(input.seconds) ? Math.round(input.seconds) : middle;
  return {
    seconds: Math.min(style.secondsMax, Math.max(style.secondsMin, asked)),
    voice: typeof input.voice === 'string' && VOICE.test(input.voice) ? input.voice : style.defaultVoice,
    mode: input.mode === 'captions' ? 'captions' : 'voice',
    music: input.music === 'none' ? 'none' : 'bed',
    endLine: oneLine(input.endLine, LIMITS.endLine),
  };
}

export function workerPresence(worker: WorkerState | null, now: Date): WorkerPresence {
  if (!worker) return 'none';
  const seen = worker.lastSeen ? new Date(worker.lastSeen).getTime() : Number.NaN;
  if (!Number.isFinite(seen) || now.getTime() - seen > OFFLINE_AFTER_MS) return 'offline';
  return worker.state;
}

export const canApprove = (job: Pick<ShortJob, 'status'>) => job.status === 'plan_ready';
export const canCancel = (job: Pick<ShortJob, 'status'>) => IN_FLIGHT.includes(job.status);
export const canRetry = (job: Pick<ShortJob, 'status'>) => job.status === 'failed';
export const canDelete = (job: Pick<ShortJob, 'status'>) => !IN_FLIGHT.includes(job.status);
/** The worker is on it, or about to be: the screens poll while any job is. */
export const isActive = (job: Pick<ShortJob, 'status'>) => WORKING.includes(job.status);

export function limitRefusal(inFlight: number, thisMonth: number): string | null {
  if (inFlight >= LIMITS.inFlight) return `You already have ${LIMITS.inFlight} shorts on the go. Finish or discard one first.`;
  if (thisMonth >= LIMITS.perMonth) return `You’ve started ${LIMITS.perMonth} shorts this month, the monthly limit.`;
  return null;
}

const IST_OFFSET_MS = 330 * 60_000;

/** The first moment of this month in India, as an ISO instant. */
export function monthStartIst(now: Date): string {
  const india = new Date(now.getTime() + IST_OFFSET_MS);
  return new Date(Date.UTC(india.getUTCFullYear(), india.getUTCMonth(), 1) - IST_OFFSET_MS).toISOString();
}

/** What the live view has, plus what a poll brought: each event once, in order. */
export function mergeEvents(have: readonly ShortEvent[], fresh: readonly ShortEvent[]): ShortEvent[] {
  const bySeq = new Map<number, ShortEvent>();
  for (const event of [...have, ...fresh]) bySeq.set(event.seq, event);
  return [...bySeq.values()].sort((left, right) => left.seq - right.seq);
}
