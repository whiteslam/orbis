// The daily autopilot for Shorts: once a day, after its start time on the person's own clock,
// the Shorts PC starts one short in the chosen style with a fresh topic, approves its plan
// itself and puts the finished video in the YouTube queue. Pure. Relative imports only,
// because the PC worker loads this file with plain Node.

import { localDate, localParts } from '../locale/dates.ts';

export type Autopilot = {
  enabled: boolean;
  /** The style every autopilot short is made in. */
  style: string;
  /** 'HH:MM' on the person's clock: the day's short is started at or after this time. */
  startTime: string;
  timezone: string;
  /** The local date (YYYY-MM-DD) the autopilot last started a short, or null. */
  lastRunOn: string | null;
};

export const AUTOPILOT_STYLE = 'cozy-tales';

export function defaultAutopilot(timezone: string): Autopilot {
  return { enabled: false, style: AUTOPILOT_STYLE, startTime: '09:00', timezone, lastRunOn: null };
}

const minutesOf = (time: string) => {
  const [hour, minute] = time.split(':').map(Number);
  return (Number.isFinite(hour) ? hour : 0) * 60 + (Number.isFinite(minute) ? minute : 0);
};

/** The local date when today's short is due to start, or null when it isn't due (off, too early, or already started today). */
export function autopilotDueOn(autopilot: Autopilot, now: Date): string | null {
  if (!autopilot.enabled) return null;
  const today = localDate(now, autopilot.timezone);
  if (autopilot.lastRunOn === today) return null;
  const parts = localParts(now, autopilot.timezone);
  if (parts.hour * 60 + parts.minute < minutesOf(autopilot.startTime)) return null;
  return today;
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

/** What the autopilot asks the PC to make: the style's own voice, music under it, nothing at the end. */
export function autopilotOptions(defaultVoice: string, seconds: number) {
  return { seconds, voice: defaultVoice, mode: 'voice' as const, music: 'bed' as const, endLine: '', autopilot: true };
}

const TIME = /^([01]\d|2[0-3]):([0-5]\d)/;

/** A stored row as the screens and the worker use it. */
export function readAutopilotRow(row: unknown, fallbackZone: string): Autopilot {
  const fallback = defaultAutopilot(fallbackZone);
  if (typeof row !== 'object' || row === null) return fallback;
  const value = row as Record<string, unknown>;
  const time = typeof value.start_time === 'string' ? TIME.exec(value.start_time) : null;
  return {
    enabled: value.enabled === true,
    style: typeof value.style === 'string' && /^[a-z0-9-]{2,40}$/.test(value.style) ? value.style : fallback.style,
    startTime: time ? `${time[1]}:${time[2]}` : fallback.startTime,
    timezone: typeof value.timezone === 'string' && value.timezone ? value.timezone : fallbackZone,
    lastRunOn: typeof value.last_run_on === 'string' ? value.last_run_on.slice(0, 10) : null,
  };
}
