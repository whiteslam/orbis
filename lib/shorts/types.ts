// Faceless Shorts: what the app, its server actions and the screens share. Client-safe.

import type { ShortPlan } from '@/lib/shorts/plan';

export type JobStatus = 'queued' | 'planning' | 'plan_ready' | 'building' | 'done' | 'failed' | 'cancelled';
export type JobStage = 'plan' | 'build';

/** A platform autopilot shorts are made for. */
export type Destination = 'youtube' | 'instagram';

export type ShortOptions = {
  seconds: number;
  /** A Kokoro voice id, e.g. am_michael. */
  voice: string;
  /** AI voice, or captions only (no voice yet). */
  mode: 'voice' | 'captions';
  music: 'bed' | 'none';
  /** The last line or handle, optional. */
  endLine: string;
  /** Started by the daily autopilot: its plan is approved and the video queued for YouTube without a person. */
  autopilot?: boolean;
  /** Where an autopilot short is posted; missing means YouTube (made before destinations existed). */
  destination?: Destination;
};

/** Storage paths in the `shorts` bucket. */
export type DeliveryFiles = { video: string; share: string | null; cover: string | null; sheet: string | null };

export type Delivery = {
  title: string;
  caption: string;
  hashtags: string[];
  /** What QA caught and fixed. */
  qa: string[];
  seconds: number;
  files: DeliveryFiles;
};

export type ShortJob = {
  id: string;
  style: string;
  topic: string;
  options: ShortOptions;
  status: JobStatus;
  stage: JobStage;
  plan: ShortPlan | null;
  planFeedback: string | null;
  delivery: Delivery | null;
  error: string | null;
  attempt: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  lastEventAt: string | null;
};

export type ShortEventKind = 'status' | 'step' | 'log' | 'qa';
export type ShortEvent = { seq: number; kind: ShortEventKind; content: string; at: string };

export type ShortStyle = {
  slug: string;
  name: string;
  tagline: string;
  bestFor: string;
  secondsMin: number;
  secondsMax: number;
  is3d: boolean;
  defaultVoice: string;
  sheetPath: string | null;
  exampleTitle: string;
  position: number;
};

export type Voice = { id: string; label: string };

export type WorkerState = {
  lastSeen: string | null;
  state: 'idle' | 'busy' | 'paused' | 'setup';
  note: string | null;
  voices: Voice[];
};

/** What the worker strip shows. `none`: the worker has never started for this account. */
export type WorkerPresence = 'none' | 'offline' | 'idle' | 'busy' | 'paused' | 'setup';
