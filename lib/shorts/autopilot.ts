// The Shorts autopilot: at night, on the person's own clock, the Shorts PC makes shorts
// (bedtime stories, funny true stories) one at a time, taking turns between the chosen styles, approves each plan itself and queues the finished video for the
// platform whose shelf is lowest (lib/shorts/shelf.ts decides). Pure. Relative imports only,
// because the PC worker loads this file with plain Node.

import type { Destination } from './types.ts';

export type Autopilot = {
  enabled: boolean;
  /** The first chosen style, kept for workers older than `styles`. */
  style: string;
  /** The styles the autopilot takes turns between, in the order picked (AUTOPILOT_STYLES). */
  styles: string[];
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
/** The styles the autopilot can make, each with its own topic list below. */
export const AUTOPILOT_STYLES = ['cozy-tales', 'tall-tale'] as const;
export type AutopilotStyle = (typeof AUTOPILOT_STYLES)[number];
export const AUTOPILOT_STYLE_LABELS: Record<AutopilotStyle, string> = { 'cozy-tales': 'Bedtime stories', 'tall-tale': 'Funny true stories' };
export const AUTOPILOT_COLUMNS = 'enabled,style,styles,start_time,window_end,shelf_days,destinations,timezone,started_on,started_count';
/** The same, before the styles column (migration 202611140004): read with this, the autopilot makes its one style. */
export const AUTOPILOT_COLUMNS_ONE_STYLE = 'enabled,style,start_time,window_end,shelf_days,destinations,timezone,started_on,started_count';
const DESTINATIONS: readonly Destination[] = ['youtube', 'instagram'];

export function defaultAutopilot(timezone: string): Autopilot {
  return {
    enabled: false, style: AUTOPILOT_STYLE, styles: [AUTOPILOT_STYLE], windowStart: '23:00', windowEnd: '07:00', shelfDays: 3, destinations: ['youtube'],
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

/** Today's bedtime story topic (pickTopic for Cozy Tales). */
export function pickStoryTopic(recentTopics: readonly string[], today: string): string {
  return pickTopic(AUTOPILOT_STYLE, recentTopics, today);
}

// Funny true stories for Tall Tale: well-documented, cheeky, nobody hurt in the telling. The
// planner checks the facts and keeps to what the sources say.
export const FUNNY_TRUE_STORIES: readonly string[] = [
  'George C. Parker, the con man who “sold” the Brooklyn Bridge to tourists again and again in the early 1900s, and gave us “I’ve got a bridge to sell you”',
  'Victor Lustig, who “sold” the Eiffel Tower for scrap metal in 1925, then tried to sell it again',
  'The Great Emu War of 1932, when Australian soldiers with machine guns lost to a flock of emus',
  'The 1904 Olympic marathon: one runner rode in a car, one was chased off course by dogs, and the winner was fed brandy on the way',
  'The 1859 Pig War, when Britain and the United States nearly went to war over a pig eating potatoes',
  'Joshua Norton, the San Francisco man who declared himself Emperor of the United States in 1859, and the city went along with it',
  'The BBC’s 1957 April Fools report on Swiss farmers harvesting spaghetti from trees, and the viewers who asked how to grow their own',
  'Mike the Headless Chicken, who lived for 18 months in 1940s Colorado and went on tour',
  'Timothy Dexter, the 1790s merchant whose silliest trades kept making him rich',
  'Project Pigeon, the Second World War plan to have pigeons steer missiles by pecking at a screen',
  'Wojtek, the bear who served with the Polish army in the Second World War and carried ammunition',
  'Jack the baboon, who worked a railway signal in 1880s South Africa and never got it wrong',
  'The Dreadnought hoax of 1910, when pranksters in fake beards toured a Royal Navy battleship as “Abyssinian princes”',
  'The Cardiff Giant of 1869, a fake stone giant so popular that P. T. Barnum made a fake of the fake',
  'The War of the Bucket in 1325, when two Italian cities fought over a stolen wooden bucket',
  'Sergeant Stubby, the stray dog who became a decorated hero of the First World War',
  'The Great Diamond Hoax of 1872, when two prospectors salted a desert with gems and fooled the richest men in America',
  'The Kentucky meat shower of 1876, when chunks of meat fell from a clear sky onto a farm',
  'Dennis Hope, the man who has been selling plots of land on the Moon since 1980',
  'The time Napoleon arranged a rabbit hunt and the rabbits charged him instead, as one of his generals told it',
  'The 1938 “War of the Worlds” radio play, and the listeners who thought Martians had landed in New Jersey',
  'Frank Hayes, the jockey who won a horse race in 1923 after he had already died in the saddle',
  'Alexander Graham Bell wanted everyone to answer the telephone with “Ahoy-hoy”, and how “hello” won instead',
  'The Trojan Room coffee pot at Cambridge, the first webcam, set up so scientists could see if the coffee was ready',
];

const TOPICS: Record<AutopilotStyle, readonly string[]> = { 'cozy-tales': STORY_IDEAS, 'tall-tale': FUNNY_TRUE_STORIES };

/** True for a style the autopilot can make. */
export const isAutopilotStyle = (style: string): style is AutopilotStyle => (AUTOPILOT_STYLES as readonly string[]).includes(style);

/**
 * The next topic for a style: the first one, starting from one picked by the date, that isn't
 * among the recent topics; once every one was used recently, the date's own.
 */
export function pickTopic(style: string, recentTopics: readonly string[], today: string): string {
  const ideas = isAutopilotStyle(style) ? TOPICS[style] : STORY_IDEAS;
  const recent = new Set(recentTopics.map(normal));
  const day = Math.floor(Date.parse(`${today}T00:00:00Z`) / 86_400_000);
  const start = Number.isFinite(day) ? ((day % ideas.length) + ideas.length) % ideas.length : 0;
  for (let step = 0; step < ideas.length; step++) {
    const idea = ideas[(start + step) % ideas.length];
    if (!recent.has(normal(idea))) return idea;
  }
  return ideas[start];
}

/**
 * Whose turn it is: the chosen style the autopilot used longest ago (never used comes first),
 * in the chosen order on a tie. `recentStyles` is the styles of its recent shorts, newest first.
 */
export function pickStyle(styles: readonly string[], recentStyles: readonly string[]): string {
  if (styles.length <= 1) return styles[0] ?? AUTOPILOT_STYLE;
  let best = styles[0];
  let bestAt = -2;
  for (const style of styles) {
    const at = recentStyles.indexOf(style);
    // Never used is the oldest of all; otherwise the further down the newest-first list, the older.
    const age = at === -1 ? Number.POSITIVE_INFINITY : at;
    if (age > bestAt) { best = style; bestAt = age; }
  }
  return best;
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

/** One or more styles the autopilot can make, none twice; anything else is null. */
const readStyles = (value: unknown): string[] | null => {
  if (!Array.isArray(value) || value.length === 0 || value.length > AUTOPILOT_STYLES.length) return null;
  if (!value.every((item) => typeof item === 'string' && isAutopilotStyle(item))) return null;
  return new Set(value).size === value.length ? (value as string[]) : null;
};

/** A stored row as the screens and the worker use it. */
export function readAutopilotRow(row: unknown, fallbackZone: string): Autopilot {
  const fallback = defaultAutopilot(fallbackZone);
  if (typeof row !== 'object' || row === null) return fallback;
  const value = row as Record<string, unknown>;
  const count = value.started_count;
  const style = typeof value.style === 'string' && /^[a-z0-9-]{2,40}$/.test(value.style) ? value.style : fallback.style;
  return {
    enabled: value.enabled === true,
    style,
    styles: readStyles(value.styles) ?? [style],
    windowStart: readTime(value.start_time, fallback.windowStart),
    windowEnd: readTime(value.window_end, fallback.windowEnd),
    shelfDays: isShelfDays(value.shelf_days) ? value.shelf_days : fallback.shelfDays,
    destinations: readDestinations(value.destinations) ?? fallback.destinations,
    timezone: typeof value.timezone === 'string' && value.timezone ? value.timezone : fallbackZone,
    startedOn: typeof value.started_on === 'string' ? value.started_on.slice(0, 10) : null,
    startedCount: Number.isInteger(count) && (count as number) >= 0 ? (count as number) : 0,
  };
}

export type AutopilotInput = { enabled: boolean; windowStart: string; windowEnd: string; shelfDays: number; destinations: Destination[]; styles: string[] };

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
  // A form without styles (an older screen) keeps bedtime stories.
  const styles = value.styles === undefined ? [AUTOPILOT_STYLE] : readStyles(value.styles);
  if (!styles) return null;
  return { enabled: value.enabled, windowStart: value.windowStart, windowEnd: value.windowEnd, shelfDays: value.shelfDays, destinations, styles };
}
