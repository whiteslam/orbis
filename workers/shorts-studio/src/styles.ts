// The style board's catalog, read from the installed skill: one entry per
// styles/<slug>/STYLE.md, so a style added to the skill shows up in Orbis.

export type StyleMeta = {
  slug: string;
  name: string;
  tagline: string;
  bestFor: string;
  secondsMin: number;
  secondsMax: number;
  is3d: boolean;
  defaultVoice: string;
  exampleTitle: string;
  position: number;
};

export type Voice = { id: string; label: string };

/** A short "best for" per known style; anything new falls back to its tagline. */
const BEST_FOR: Record<string, string> = {
  'deep-dive': 'What happens if… body and science',
  'night-file': 'Mysteries and true crime',
  'inside-out': 'Quick 2D science explainers',
  'stick-story': 'Survival steps and life hacks',
  'paper-atlas': 'History and how it happened',
  'tall-tale': 'Funny true stories',
  'cozy-tales': 'Bedtime stories for kids',
};

/** The board's order: the flagship first, then the rest as the skill lists them. */
export const STYLE_ORDER = ['deep-dive', 'night-file', 'inside-out', 'stick-story', 'paper-atlas', 'tall-tale', 'cozy-tales'];

const VOICE = /^[a-z]{2}_[a-z]+$/;

export function parseStyle(slug: string, styleMd: string, exampleScript: string | null, position: number): StyleMeta {
  const heading = /^#\s+(.+)$/m.exec(styleMd)?.[1]?.trim() ?? slug;
  const colon = heading.indexOf(':');
  const name = (colon > 0 ? heading.slice(0, colon) : heading).trim();
  // "flat 2D "What happens if…?" shorts, 9:16" → drop the aspect ratio and anything after it.
  const tagline = (colon > 0 ? heading.slice(colon + 1) : '').replace(/,\s*9:16.*$/, '').trim();

  const formatLine = styleMd.split('\n').find((line) => line.includes('1080x1920')) ?? '';
  const range = /(\d{2})-(\d{2}) s\b/.exec(formatLine);
  const secondsMin = range ? Number(range[1]) : 30;
  const secondsMax = range ? Number(range[2]) : 45;

  const exampleTitle = /example\/`\s*=\s*\*\*([^*]+)\*\*/.exec(styleMd)?.[1]?.trim() ?? '';

  let defaultVoice = 'am_michael';
  if (exampleScript) {
    try {
      const voice = (JSON.parse(exampleScript) as { voice?: unknown }).voice;
      if (typeof voice === 'string' && VOICE.test(voice)) defaultVoice = voice;
    } catch {
      // A broken example keeps the skill's default voice.
    }
  }

  return {
    slug,
    name: name.slice(0, 80),
    tagline: tagline.slice(0, 300),
    bestFor: (BEST_FOR[slug] ?? tagline).slice(0, 120),
    secondsMin,
    secondsMax,
    is3d: /\b3D\b/.test(name),
    defaultVoice,
    exampleTitle: exampleTitle.slice(0, 200),
    position,
  };
}

/** `voice.py --list` prints "am_michael   US male, steady explainer (default)" per line. */
export function parseVoices(listOutput: string): Voice[] {
  return listOutput.split('\n').flatMap((line) => {
    const match = /^\s*([a-z]{2}_[a-z]+)\s+(.+?)\s*$/.exec(line);
    return match ? [{ id: match[1], label: match[2].slice(0, 80) }] : [];
  });
}
