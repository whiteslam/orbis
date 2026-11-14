// The Shorts autopilot: at night, on the person's own clock, the Shorts PC makes bedtime
// stories one at a time, approves each plan itself and queues the finished video for the
// platform whose shelf is lowest (lib/shorts/shelf.ts decides). Pure. Relative imports only,
// because the PC worker loads this file with plain Node.

import type { Destination } from './types.ts';

export type Autopilot = {
  enabled: boolean;
  /** The style every autopilot short is made in. */
  style: string;
  /** 'HH:MM' on the person's clock: builds start at or after this time… */
  windowStart: string;
  /** …and before this one. The window may cross midnight; the same time for both means any time. */
  windowEnd: string;
  /** How many days of posts to keep ready, 1–7. */
  shelfDays: number;
  /** The platforms autopilot shorts are made for. */
  destinations: Destination[];
  timezone: string;
  /** The local date (YYYY-MM-DD) of the last counted start, and how many started that day. */
  startedOn: string | null;
  startedCount: number;
};

export const AUTOPILOT_STYLE = 'cozy-tales';
export const AUTOPILOT_COLUMNS = 'enabled,style,start_time,window_end,shelf_days,destinations,timezone,started_on,started_count';
const DESTINATIONS: readonly Destination[] = ['youtube', 'instagram'];

export function defaultAutopilot(timezone: string): Autopilot {
  return {
    enabled: false, style: AUTOPILOT_STYLE, windowStart: '23:00', windowEnd: '07:00', shelfDays: 3, destinations: ['youtube'],
    timezone, startedOn: null, startedCount: 0,
  };
}

// Gentle bedtime stories: a baby animal, and a small, warm thing that happens to it. Pairs are
// walked in a fixed shuffled order, so the stories vary and none comes back until the rest have run.
const ANIMALS = [
  'baby owl', 'little bunny', 'tiny hedgehog', 'baby fox', 'little panda', 'baby duckling', 'little kitten', 'baby elephant',
  'tiny mouse', 'baby penguin', 'little puppy', 'baby deer', 'little koala', 'baby otter', 'tiny squirrel', 'baby bear',
];
const STORIES = [
  'who can’t fall asleep and counts the stars',
  'who finds a lost firefly and helps it home',
  'who is scared of the dark until the moon says hello',
  'who shares a blanket with a friend on a cold night',
  'who wants one more bedtime story',
  'who follows a sleepy cloud across the sky',
  'who builds a cosy nest from autumn leaves',
  'who learns a lullaby from the wind',
  'who waits for the first snow of winter',
  'who makes a wish on a falling star',
  'who helps the sun go to bed',
  'who has a quiet picnic under the night sky',
];

/** Every story idea, in a fixed order that mixes animals and stories. */
export const STORY_IDEAS: readonly string[] = (() => {
  const ideas: string[] = [];
  // Round r gives every animal a story, shifted per animal, so neighbours differ and each animal
  // meets every story exactly once over all the rounds.
  for (let round = 0; round < STORIES.length; round++) {
    for (const [at, animal] of ANIMALS.entries()) {
      ideas.push(`A gentle bedtime story about a ${animal} ${STORIES[(round + at * 5) % STORIES.length]}`);
    }
  }
  return ideas;
})();

const normal = (text: string) => text.trim().toLowerCase();

/**
 * Today's topic: the first idea, starting from one picked by the date, that isn't among the
 * recent topics. Once every idea has been used recently, the one picked by the date.
 */
export function pickStoryTopic(recentTopics: readonly string[], today: string): string {
  const recent = new Set(recentTopics.map(normal));
  const day = Math.floor(Date.parse(`${today}T00:00:00Z`) / 86_400_000);
  const start = Number.isFinite(day) ? ((day % STORY_IDEAS.length) + STORY_IDEAS.length) % STORY_IDEAS.length : 0;
  for (let step = 0; step < STORY_IDEAS.length; step++) {
    const idea = STORY_IDEAS[(start + step) % STORY_IDEAS.length];
    if (!recent.has(normal(idea))) return idea;
  }
  return STORY_IDEAS[start];
}

/** What the autopilot asks the PC to make: the style's own voice, music under it, nothing at the end, and where it posts. */
export function autopilotOptions(defaultVoice: string, seconds: number, destination: Destination) {
  return { seconds, voice: defaultVoice, mode: 'voice' as const, music: 'bed' as const, endLine: '', autopilot: true, destination };
}

const TIME = /^([01]\d|2[0-3]):([0-5]\d)/;
const FORM_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const readTime = (value: unknown, fallback: string) => {
  const time = typeof value === 'string' ? TIME.exec(value) : null;
  return time ? `${time[1]}:${time[2]}` : fallback;
};
const isShelfDays = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 7;
/** One or two known platforms, none twice; anything else is null. */
const readDestinations = (value: unknown): Destination[] | null => {
  if (!Array.isArray(value) || value.length === 0 || value.length > DESTINATIONS.length) return null;
  if (!value.every((item) => DESTINATIONS.includes(item as Destination))) return null;
  return new Set(value).size === value.length ? (value as Destination[]) : null;
};

/** A stored row as the screens and the worker use it. */
export function readAutopilotRow(row: unknown, fallbackZone: string): Autopilot {
  const fallback = defaultAutopilot(fallbackZone);
  if (typeof row !== 'object' || row === null) return fallback;
  const value = row as Record<string, unknown>;
  const count = value.started_count;
  return {
    enabled: value.enabled === true,
    style: typeof value.style === 'string' && /^[a-z0-9-]{2,40}$/.test(value.style) ? value.style : fallback.style,
    windowStart: readTime(value.start_time, fallback.windowStart),
    windowEnd: readTime(value.window_end, fallback.windowEnd),
    shelfDays: isShelfDays(value.shelf_days) ? value.shelf_days : fallback.shelfDays,
    destinations: readDestinations(value.destinations) ?? fallback.destinations,
    timezone: typeof value.timezone === 'string' && value.timezone ? value.timezone : fallbackZone,
    startedOn: typeof value.started_on === 'string' ? value.started_on.slice(0, 10) : null,
    startedCount: Number.isInteger(count) && (count as number) >= 0 ? (count as number) : 0,
  };
}

export type AutopilotInput = { enabled: boolean; windowStart: string; windowEnd: string; shelfDays: number; destinations: Destination[] };

/** The Autopilot card's form, checked; null when any field is wrong. */
export function readAutopilotInput(raw: unknown): AutopilotInput | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.enabled !== 'boolean') return null;
  if (typeof value.windowStart !== 'string' || !FORM_TIME.test(value.windowStart)) return null;
  if (typeof value.windowEnd !== 'string' || !FORM_TIME.test(value.windowEnd)) return null;
  if (!isShelfDays(value.shelfDays)) return null;
  const destinations = readDestinations(value.destinations);
  if (!destinations) return null;
  return { enabled: value.enabled, windowStart: value.windowStart, windowEnd: value.windowEnd, shelfDays: value.shelfDays, destinations };
}
