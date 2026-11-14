// The Shorts autopilot on the PC: once a day it starts one short with a fresh topic
// (lib/shorts/autopilot.ts says when and which), approves that short's plan as soon
// as it is written, and puts the finished video in the YouTube queue for the
// schedule to post. Everything goes through the service role, for OWNER_USER_ID only.

import { createClient } from '@supabase/supabase-js';
import { autopilotDueOn, autopilotOptions, pickStoryTopic, readAutopilotRow } from '../../../lib/shorts/autopilot.ts';
import type { ShortPlan } from '../../../lib/shorts/plan.ts';
import type { Delivery } from '../../../lib/shorts/types.ts';
import { buildDetails, cleanDetails, defaultPreset } from '../../../lib/youtube/details.ts';
import type { Preset, Privacy } from '../../../lib/youtube/types.ts';
import type { JobRow } from './db.ts';

export interface AutopilotDb {
  /** Starts today's short when it is due. Returns its topic, or null when nothing was started. */
  startIfDue(owner: string, now: Date): Promise<string | null>;
  /** Moves an autopilot short from plan_ready straight on to building, as Approve does. */
  approve(job: JobRow, plan: ShortPlan): Promise<boolean>;
  /** Adds a finished autopilot short to the YouTube queue. Returns what happened, for the log. */
  queueForYouTube(job: JobRow, delivery: Delivery): Promise<'queued' | 'already' | 'unavailable'>;
}

/** True for a job the autopilot started: it approves its own plan and queues itself for YouTube. */
export const isAutopilotJob = (job: Pick<JobRow, 'options'>) => (job.options as { autopilot?: unknown } | null)?.autopilot === true;

/** The table or column isn't there yet: the autopilot migration hasn't been run. */
const missing = (error: { code?: string } | null) => ['42P01', 'PGRST205', '42703', 'PGRST204'].includes(error?.code ?? '');

function check(error: { message?: string } | null, what: string) {
  if (error) throw new Error(`${what}: ${error.message ?? 'unknown error'}`);
}

const PRIVACIES: readonly Privacy[] = ['public', 'unlisted', 'private'];

function presetFrom(row: Record<string, unknown> | null, style: string): Preset {
  const fallback = defaultPreset(style);
  if (!row) return fallback;
  return {
    style,
    privacy: PRIVACIES.includes(row.privacy as Privacy) ? (row.privacy as Privacy) : fallback.privacy,
    categoryId: typeof row.category_id === 'string' && /^\d{1,3}$/.test(row.category_id) ? row.category_id : fallback.categoryId,
    madeForKids: row.made_for_kids === true,
    tags: Array.isArray(row.tags) ? row.tags.filter((tag): tag is string => typeof tag === 'string') : [],
  };
}

export function createAutopilotDb(url: string, key: string): AutopilotDb {
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });

  return {
    async startIfDue(owner, now) {
      const { data: row, error } = await db.from('shorts_autopilot').select('enabled,style,start_time,timezone,last_run_on').eq('user_id', owner).maybeSingle();
      if (error) {
        if (missing(error)) return null;
        check(error, 'Reading the autopilot');
      }
      const autopilot = readAutopilotRow(row, 'Asia/Kolkata');
      const today = autopilotDueOn(autopilot, now);
      if (!today) return null;

      // One a day even with two workers or a restart: only the update that moves last_run_on on starts a short.
      const { data: taken, error: takeError } = await db.from('shorts_autopilot')
        .update({ last_run_on: today })
        .eq('user_id', owner)
        .or(`last_run_on.is.null,last_run_on.lt.${today}`)
        .select('user_id');
      check(takeError, 'Starting the autopilot’s day');
      if (!taken?.length) return null;

      const [{ data: style, error: styleError }, { data: recent, error: recentError }] = await Promise.all([
        db.from('shorts_styles').select('default_voice,seconds_min,seconds_max').eq('slug', autopilot.style).maybeSingle(),
        db.from('shorts_jobs').select('topic').eq('user_id', owner).eq('style', autopilot.style).order('created_at', { ascending: false }).limit(150),
      ]);
      check(styleError, 'Reading the autopilot’s style');
      check(recentError, 'Reading recent shorts');
      if (!style) throw new Error(`The autopilot’s style "${autopilot.style}" isn’t installed on this PC.`);

      const topic = pickStoryTopic((recent ?? []).map((one) => String(one.topic)), today);
      // Halfway through the style's length: a full story without running long.
      const seconds = Math.round(((style.seconds_min as number) + (style.seconds_max as number)) / 2);
      const { error: insertError } = await db.from('shorts_jobs').insert({
        user_id: owner,
        style: autopilot.style,
        topic,
        options: autopilotOptions(String(style.default_voice), seconds),
      });
      check(insertError, 'Queueing the autopilot’s short');
      return topic;
    },

    async approve(job, plan) {
      const { data, error } = await db.from('shorts_jobs')
        .update({ plan, status: 'queued', stage: 'build', plan_feedback: null, error: null, started_at: null, finished_at: null })
        .eq('id', job.id).eq('user_id', job.user_id).eq('status', 'plan_ready')
        .select('id');
      check(error, 'Approving the autopilot’s plan');
      return Boolean(data?.length);
    },

    async queueForYouTube(job, delivery) {
      const video = delivery.files?.video;
      const own = (path: string | null | undefined): path is string => typeof path === 'string' && path.startsWith(`${job.user_id}/${job.id}/`) && !path.includes('..');
      if (!own(video)) throw new Error('The finished short has no video to queue.');

      const { data: presetRow, error: presetError } = await db.from('youtube_presets').select('privacy,category_id,made_for_kids,tags').eq('user_id', job.user_id).eq('style', job.style).maybeSingle();
      if (presetError && missing(presetError)) return 'unavailable';
      check(presetError, 'Reading the YouTube preset');
      const details = cleanDetails(buildDetails(delivery, presetFrom(presetRow, job.style)));
      if (!details) throw new Error('The short’s title and caption couldn’t be made into YouTube details.');

      const { data: last, error: lastError } = await db.from('youtube_queue').select('position').eq('user_id', job.user_id).order('position', { ascending: false }).limit(1);
      if (lastError && missing(lastError)) return 'unavailable';
      check(lastError, 'Reading the YouTube queue');
      const top = last?.[0]?.position;
      const { error } = await db.from('youtube_queue').insert({
        user_id: job.user_id,
        job_id: job.id,
        video_path: video,
        cover_path: own(delivery.files?.cover) ? delivery.files.cover : null,
        position: typeof top === 'number' ? top + 1 : 1,
        status: 'queued',
        title: details.title,
        description: details.description,
        tags: details.tags,
        category_id: details.categoryId,
        privacy: details.privacy,
        made_for_kids: details.madeForKids,
      });
      if (error?.code === '23505') return 'already';
      if (error && missing(error)) return 'unavailable';
      check(error, 'Adding the short to the YouTube queue');
      return 'queued';
    },
  };
}
