// Database rows → the typed shapes the screens use. The worker writes the JSON
// columns, so nothing in them is trusted: a plan or delivery that doesn't
// check out reads as null rather than reaching the page half-formed.

import { validatePlan } from '@/lib/shorts/plan';
import type { Delivery, JobStage, JobStatus, ShortEvent, ShortEventKind, ShortJob, ShortOptions, ShortStyle, Voice, WorkerState } from '@/lib/shorts/types';

type Row = Record<string, unknown>;

const STATUSES: readonly JobStatus[] = ['queued', 'planning', 'plan_ready', 'building', 'done', 'failed', 'cancelled'];
const KINDS: readonly ShortEventKind[] = ['status', 'step', 'log', 'qa'];
const WORKER_STATES: readonly WorkerState['state'][] = ['idle', 'busy', 'paused', 'setup'];
const VOICE = /^[a-z]{2}_[a-z]+$/;

const isRow = (value: unknown): value is Row => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown, fallback = '') => (typeof value === 'string' ? value : fallback);
const textOrNull = (value: unknown) => (typeof value === 'string' && value ? value : null);
const num = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
const strings = (value: unknown, max: number) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim() !== '').map((item) => item.trim()).slice(0, max) : []);

function readOptionsRow(value: unknown): ShortOptions {
  const row = isRow(value) ? value : {};
  return {
    seconds: num(row.seconds, 35),
    voice: typeof row.voice === 'string' && VOICE.test(row.voice) ? row.voice : 'am_michael',
    mode: row.mode === 'captions' ? 'captions' : 'voice',
    music: row.music === 'none' ? 'none' : 'bed',
    endLine: text(row.endLine),
  };
}

function readDelivery(value: unknown): Delivery | null {
  if (!isRow(value) || !isRow(value.files)) return null;
  const title = text(value.title).trim();
  const video = textOrNull(value.files.video);
  if (!title || !video) return null;
  return {
    title,
    caption: text(value.caption),
    hashtags: strings(value.hashtags, 12).map((tag) => (tag.startsWith('#') ? tag : `#${tag}`)),
    qa: strings(value.qa, 30),
    seconds: num(value.seconds, 0),
    files: { video, share: textOrNull(value.files.share), cover: textOrNull(value.files.cover), sheet: textOrNull(value.files.sheet) },
  };
}

export function readJob(row: unknown): ShortJob | null {
  if (!isRow(row) || typeof row.id !== 'string' || !STATUSES.includes(row.status as JobStatus)) return null;
  const plan = row.plan == null ? null : validatePlan(row.plan);
  return {
    id: row.id,
    style: text(row.style),
    topic: text(row.topic),
    options: readOptionsRow(row.options),
    status: row.status as JobStatus,
    stage: (row.stage === 'build' ? 'build' : 'plan') as JobStage,
    plan: plan?.ok ? plan.plan : null,
    planFeedback: textOrNull(row.plan_feedback),
    delivery: readDelivery(row.delivery),
    error: textOrNull(row.error),
    attempt: num(row.attempt, 1),
    createdAt: text(row.created_at),
    startedAt: textOrNull(row.started_at),
    finishedAt: textOrNull(row.finished_at),
    lastEventAt: textOrNull(row.last_event_at),
  };
}

export function readEvent(row: unknown): ShortEvent | null {
  if (!isRow(row) || typeof row.seq !== 'number' || !KINDS.includes(row.kind as ShortEventKind)) return null;
  return { seq: row.seq, kind: row.kind as ShortEventKind, content: text(row.content), at: text(row.at) };
}

export function readStyle(row: unknown): ShortStyle | null {
  if (!isRow(row) || typeof row.slug !== 'string' || typeof row.name !== 'string') return null;
  return {
    slug: row.slug,
    name: row.name,
    tagline: text(row.tagline),
    bestFor: text(row.best_for),
    secondsMin: num(row.seconds_min, 30),
    secondsMax: num(row.seconds_max, 45),
    is3d: row.is_3d === true,
    defaultVoice: text(row.default_voice, 'am_michael'),
    sheetPath: textOrNull(row.sheet_path),
    exampleTitle: text(row.example_title),
    position: num(row.position, 0),
  };
}

function readVoice(value: unknown): Voice | null {
  if (!isRow(value) || typeof value.id !== 'string' || !VOICE.test(value.id)) return null;
  return { id: value.id, label: text(value.label, value.id) };
}

export function readWorker(row: unknown): WorkerState | null {
  if (!isRow(row)) return null;
  return {
    lastSeen: textOrNull(row.last_seen),
    state: WORKER_STATES.includes(row.state as WorkerState['state']) ? (row.state as WorkerState['state']) : 'setup',
    note: textOrNull(row.note),
    voices: (Array.isArray(row.voices) ? row.voices : []).map(readVoice).filter((voice): voice is Voice => voice !== null),
  };
}
