// The worker's side of the Shorts tables, through the service role. Every
// status change names the status it expects, so a job the owner cancelled (or
// a second worker took) is never overwritten.

import { createClient } from '@supabase/supabase-js';
import type { ShortPlan } from '../../../lib/shorts/plan.ts';
import type { Delivery, ShortOptions } from '../../../lib/shorts/types.ts';
import type { StyleMeta, Voice } from './styles.ts';

export type JobRow = {
  id: string;
  user_id: string;
  style: string;
  topic: string;
  options: ShortOptions;
  status: string;
  stage: 'plan' | 'build';
  plan: unknown;
  plan_feedback: string | null;
  attempt: number;
};

export type EventKind = 'status' | 'step' | 'log' | 'qa';
export type WorkerMode = 'idle' | 'busy' | 'paused' | 'setup';

export interface WorkerDb {
  nextJob(owner: string): Promise<JobRow | null>;
  claim(job: JobRow): Promise<boolean>;
  event(job: JobRow, kind: EventKind, content: string): Promise<void>;
  finishPlan(job: JobRow, plan: ShortPlan): Promise<boolean>;
  finishBuild(job: JobRow, delivery: Delivery): Promise<boolean>;
  fail(job: JobRow, message: string): Promise<void>;
  stillRunning(job: JobRow): Promise<boolean>;
  upload(path: string, bytes: Uint8Array, contentType: string): Promise<void>;
  heartbeat(owner: string, state: WorkerMode, note: string | null, voices?: Voice[]): Promise<void>;
  syncStyles(styles: StyleMeta[], sheets: Map<string, Uint8Array>): Promise<void>;
  /** Fails the owner's jobs left mid-run: by a restart (all of them) or by silence (60 min). */
  sweep(owner: string, mode: 'restart' | 'stale'): Promise<number>;
}

export const STALE_MS = 60 * 60_000;
const BUCKET = 'shorts';
const JOB_COLUMNS = 'id,user_id,style,topic,options,status,stage,plan,plan_feedback,attempt';
const RUNNING = ['planning', 'building'];
const VERSION = '1';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function check(error: { message?: string } | null, what: string) {
  if (error) throw new Error(`${what}: ${error.message ?? 'unknown error'}`);
}

export function createWorkerDb(url: string, key: string): WorkerDb {
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const seqs = new Map<string, number>();
  const now = () => new Date().toISOString();

  async function lastSeq(jobId: string) {
    const { data, error } = await db.from('shorts_events').select('seq').eq('job_id', jobId).order('seq', { ascending: false }).limit(1);
    check(error, 'Reading events');
    return (data?.[0]?.seq as number | undefined) ?? 0;
  }

  return {
    async nextJob(owner) {
      const { data, error } = await db.from('shorts_jobs').select(JOB_COLUMNS).eq('user_id', owner).eq('status', 'queued').order('created_at', { ascending: true }).limit(1);
      check(error, 'Reading the queue');
      return (data?.[0] as JobRow | undefined) ?? null;
    },

    async claim(job) {
      const status = job.stage === 'build' ? 'building' : 'planning';
      const { data, error } = await db.from('shorts_jobs')
        .update({ status, started_at: now(), finished_at: null, error: null, last_event_at: now() })
        .eq('id', job.id).eq('user_id', job.user_id).eq('status', 'queued').select('id');
      check(error, 'Claiming a job');
      if (!data?.length) return false;
      seqs.set(job.id, await lastSeq(job.id));
      return true;
    },

    async event(job, kind, content) {
      const text = content.slice(0, 4000);
      if (!text.trim()) return;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const seq = (seqs.get(job.id) ?? 0) + 1;
        seqs.set(job.id, seq);
        const { error } = await db.from('shorts_events').insert({ user_id: job.user_id, job_id: job.id, seq, kind, content: text });
        if (!error) break;
        // Another writer took that seq: re-read and go again.
        if ((error as { code?: string }).code === '23505') { seqs.set(job.id, await lastSeq(job.id)); continue; }
        // The job was deleted (foreign key) or the table is gone: progress is best effort.
        return;
      }
      await db.from('shorts_jobs').update({ last_event_at: now() }).eq('id', job.id).in('status', RUNNING);
    },

    async finishPlan(job, plan) {
      const { data, error } = await db.from('shorts_jobs').update({ status: 'plan_ready', plan, plan_feedback: null, finished_at: now() })
        .eq('id', job.id).eq('status', 'planning').select('id');
      check(error, 'Saving the plan');
      return Boolean(data?.length);
    },

    async finishBuild(job, delivery) {
      const { data, error } = await db.from('shorts_jobs').update({ status: 'done', delivery, finished_at: now() })
        .eq('id', job.id).eq('status', 'building').select('id');
      check(error, 'Saving the short');
      return Boolean(data?.length);
    },

    async fail(job, message) {
      const { error } = await db.from('shorts_jobs').update({ status: 'failed', error: message.slice(0, 500), finished_at: now() })
        .eq('id', job.id).in('status', RUNNING);
      check(error, 'Marking a job failed');
    },

    async stillRunning(job) {
      const { data, error } = await db.from('shorts_jobs').select('status').eq('id', job.id).maybeSingle();
      // A read that failed isn't a cancel: keep going.
      if (error) return true;
      return Boolean(data && RUNNING.includes(data.status as string));
    },

    async upload(path, bytes, contentType) {
      let last: unknown = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const { error } = await db.storage.from(BUCKET).upload(path, bytes, { contentType, upsert: true });
        if (!error) return;
        last = error;
        await sleep(2000 * 2 ** attempt);
      }
      throw new Error(`Uploading ${path.split('/').pop()}: ${(last as { message?: string })?.message ?? 'failed'}`);
    },

    async heartbeat(owner, state, note, voices) {
      const row: Record<string, unknown> = { user_id: owner, last_seen: now(), state, note: note?.slice(0, 1000) ?? null, version: VERSION };
      if (voices) row.voices = voices;
      const { error } = await db.from('shorts_worker').upsert(row, { onConflict: 'user_id' });
      check(error, 'Sending the heartbeat');
    },

    async syncStyles(styles, sheets) {
      const rows = [];
      for (const style of styles) {
        const sheet = sheets.get(style.slug);
        let sheetPath: string | null = null;
        if (sheet) {
          sheetPath = `styles/${style.slug}.png`;
          const { error } = await db.storage.from(BUCKET).upload(sheetPath, sheet, { contentType: 'image/png', upsert: true });
          if (error) sheetPath = null;
        }
        rows.push({
          slug: style.slug, name: style.name, tagline: style.tagline, best_for: style.bestFor,
          seconds_min: style.secondsMin, seconds_max: style.secondsMax, is_3d: style.is3d, default_voice: style.defaultVoice,
          sheet_path: sheetPath, example_title: style.exampleTitle, position: style.position, synced_at: now(),
        });
      }
      const { error } = await db.from('shorts_styles').upsert(rows, { onConflict: 'slug' });
      check(error, 'Syncing the styles');
    },

    async sweep(owner, mode) {
      let query = db.from('shorts_jobs')
        .update({
          status: 'failed',
          finished_at: now(),
          error: mode === 'restart' ? 'The worker restarted during this short. Retry it.' : 'The worker stopped hearing from this short (an hour with no progress). Retry it.',
        })
        .eq('user_id', owner).in('status', RUNNING);
      if (mode === 'stale') query = query.lt('last_event_at', new Date(Date.now() - STALE_MS).toISOString());
      const { data, error } = await query.select('id');
      check(error, 'Sweeping stuck jobs');
      return data?.length ?? 0;
    },
  };
}
