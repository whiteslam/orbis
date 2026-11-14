// The Shorts autopilot on the PC: in the night window it starts one short at a time,
// for the platform whose shelf is lowest (lib/shorts/shelf.ts decides), approves that
// short's plan as soon as it is written, and puts the finished video in the YouTube
// queue for the schedule to post. Everything goes through the service role, for
// OWNER_USER_ID only.

import { createClient } from '@supabase/supabase-js';
import { AUTOPILOT_COLUMNS, AUTOPILOT_COLUMNS_ONE_STYLE, autopilotOptions, pickStyle, pickTopic, readAutopilotRow } from '../../../lib/shorts/autopilot.ts';
import type { ShortPlan } from '../../../lib/shorts/plan.ts';
import { decideStart, type ShelfCount } from '../../../lib/shorts/shelf.ts';
import type { Delivery, Destination } from '../../../lib/shorts/types.ts';
import { buildDetails, cleanDetails, defaultPreset } from '../../../lib/youtube/details.ts';
import type { Preset, Privacy } from '../../../lib/youtube/types.ts';
import type { JobRow } from './db.ts';

export type BuildWindow = { windowStart: string; windowEnd: string; timezone: string };

export interface AutopilotDb {
  /** Starts the next autopilot short when the shelf, the window and the day's cap allow. Null when nothing was started. */
  startNext(owner: string, now: Date): Promise<{ topic: string; destination: Destination; style: string } | null>;
  /** The build window, or null when the autopilot is off or not set up. */
  window(owner: string): Promise<BuildWindow | null>;
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

/** A job still being made: IN_FLIGHT in lib/shorts/rules.ts (which this file can't import: it uses the app's @/ paths). */
const IN_FLIGHT = ['queued', 'planning', 'plan_ready', 'building'];

/**
 * The YouTube shelf, or null while YouTube can't post (not connected, or needs
 * connecting again): nothing is built for a platform that can't post it.
 */
export function youtubeShelf(input: { connection: { status: string } | null; postTimes: string[] | null; queued: number; building: number }): ShelfCount | null {
  if (!input.connection || input.connection.status === 'reconnect_required') return null;
  return { destination: 'youtube', postsPerDay: Math.max(1, input.postTimes?.length ?? 0), onShelf: input.queued + input.building };
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

  /** The autopilot row, or null when its table or columns aren't there yet. */
  async function readRow(owner: string) {
    let { data: row, error } = await db.from('shorts_autopilot').select(AUTOPILOT_COLUMNS).eq('user_id', owner).maybeSingle();
    // Before the styles column (202611140004): the one style it had, so bedtime stories carry on.
    if (error && missing(error)) ({ data: row, error } = await db.from('shorts_autopilot').select(AUTOPILOT_COLUMNS_ONE_STYLE).eq('user_id', owner).maybeSingle());
    if (error) {
      if (missing(error)) return null;
      check(error, 'Reading the autopilot');
    }
    return readAutopilotRow(row, 'Asia/Kolkata');
  }

  /** The YouTube shelf, or null when YouTube can't post or its tables aren't there yet. */
  async function readYouTubeShelf(owner: string, building: number): Promise<ShelfCount | null> {
    const { data: connection, error: connectionError } = await db.from('social_connections').select('status')
      .eq('user_id', owner).eq('platform', 'youtube').maybeSingle();
    if (connectionError && missing(connectionError)) return null;
    check(connectionError, 'Reading the YouTube connection');

    // post_times came in a later migration; before it, post_time was the one time a day.
    let settings = await db.from('youtube_settings').select('post_times,post_time').eq('user_id', owner).maybeSingle();
    if (settings.error && missing(settings.error)) settings = await db.from('youtube_settings').select('post_time').eq('user_id', owner).maybeSingle();
    if (settings.error && missing(settings.error)) return null;
    check(settings.error, 'Reading the YouTube schedule');
    const times = settings.data as { post_times?: unknown; post_time?: unknown } | null;
    const postTimes = Array.isArray(times?.post_times) && times.post_times.length > 0
      ? times.post_times.filter((time): time is string => typeof time === 'string')
      : typeof times?.post_time === 'string' ? [times.post_time] : null;

    const { count, error: queueError } = await db.from('youtube_queue').select('id', { count: 'exact', head: true })
      .eq('user_id', owner).in('status', ['queued', 'uploading']);
    if (queueError && missing(queueError)) return null;
    check(queueError, 'Reading the YouTube queue');

    return youtubeShelf({ connection: connection as { status: string } | null, postTimes, queued: count ?? 0, building });
  }

  return {
    async window(owner) {
      const autopilot = await readRow(owner);
      return autopilot?.enabled ? { windowStart: autopilot.windowStart, windowEnd: autopilot.windowEnd, timezone: autopilot.timezone } : null;
    },

    async startNext(owner, now) {
      const autopilot = await readRow(owner);
      if (!autopilot?.enabled) return null;

      // Autopilot shorts still being made, and where each will post (none recorded: YouTube).
      const { data: making, error: makingError } = await db.from('shorts_jobs').select('options')
        .eq('user_id', owner).in('status', IN_FLIGHT).eq('options->>autopilot', 'true');
      check(makingError, 'Reading the shorts being made');
      const inProgress = making ?? [];
      const madeFor = (destination: Destination) => inProgress
        .filter((job) => ((job.options as { destination?: Destination } | null)?.destination ?? 'youtube') === destination).length;

      const shelves: ShelfCount[] = [];
      if (autopilot.destinations.includes('youtube')) {
        const shelf = await readYouTubeShelf(owner, madeFor('youtube'));
        if (shelf) shelves.push(shelf);
      }

      const decision = decideStart({ autopilot, now, inProgress: inProgress.length, shelves });
      if (!decision) return null;

      // Never past the day's cap, even with two workers or a restart: only the caller
      // whose update moved the day's counter starts a short.
      const { data: taken, error: takeError } = await db.rpc('shorts_autopilot_start', { p_user: owner, p_today: decision.today, p_cap: decision.cap });
      if (takeError && missing(takeError)) return null;
      check(takeError, 'Counting the autopilot’s start');
      if (taken !== true) return null;
      const today = decision.today;

      // Whose turn: the chosen style the autopilot used longest ago.
      const { data: lately, error: latelyError } = await db.from('shorts_jobs').select('style')
        .eq('user_id', owner).eq('options->>autopilot', 'true').order('created_at', { ascending: false }).limit(20);
      check(latelyError, 'Reading the autopilot’s recent shorts');
      const chosen = pickStyle(autopilot.styles, (lately ?? []).map((one) => String(one.style)));

      const [{ data: style, error: styleError }, { data: recent, error: recentError }] = await Promise.all([
        db.from('shorts_styles').select('default_voice,seconds_min,seconds_max').eq('slug', chosen).maybeSingle(),
        db.from('shorts_jobs').select('topic').eq('user_id', owner).eq('style', chosen).order('created_at', { ascending: false }).limit(150),
      ]);
      check(styleError, 'Reading the autopilot’s style');
      check(recentError, 'Reading recent shorts');
      if (!style) throw new Error(`The autopilot’s style "${chosen}" isn’t installed on this PC.`);

      const topic = pickTopic(chosen, (recent ?? []).map((one) => String(one.topic)), today);
      // Halfway through the style's length: a full story without running long.
      const seconds = Math.round(((style.seconds_min as number) + (style.seconds_max as number)) / 2);
      const { error: insertError } = await db.from('shorts_jobs').insert({
        user_id: owner,
        style: chosen,
        topic,
        options: autopilotOptions(String(style.default_voice), seconds, decision.destination),
      });
      check(insertError, 'Queueing the autopilot’s short');
      return { topic, destination: decision.destination, style: chosen };
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
