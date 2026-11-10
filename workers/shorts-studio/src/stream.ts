// Claude Code's `--output-format stream-json` → the steps Orbis shows. One
// line of the stream can hold several content blocks; each Bash command the
// skill runs maps to a friendly step, and Claude's own words become log lines.

export type Step = { kind: 'step' | 'log' | 'qa'; content: string };

/** First match wins: the more specific patterns come first. */
const STEPS: Array<[RegExp, string]> = [
  [/new_video\.sh/, 'Setting up the project'],
  [/voice\.py(?!.*--list)/, 'Recording the voice'],
  [/words\.py/, 'Timing every word'],
  [/estimate\.py/, 'Timing the captions'],
  [/capture\.mjs\s+check/, 'Checking the shots'],
  [/capture\.mjs\s+cues/, 'Placing sound cues'],
  [/mix\.py/, 'Mixing sound and music'],
  [/capture\.mjs\s+sheet/, 'QA: checking every frame'],
  [/capture\.mjs\s+frames/, 'Looking at key frames'],
  [/capture\.mjs\s+video/, 'Rendering the video'],
  [/ffmpeg\b.*share\.mp4/, 'Making the share copy'],
];

export const LOG_MAX = 2000;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

export function stepForCommand(command: string): string | null {
  for (const [pattern, label] of STEPS) if (pattern.test(command)) return label;
  return null;
}

function textStep(text: string): Step | null {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  const content = clean.length > LOG_MAX ? `${clean.slice(0, LOG_MAX - 1)}…` : clean;
  return { kind: /^QA:/i.test(clean) ? 'qa' : 'log', content };
}

/** One line of the stream → the events it is worth (none for most). Never throws. */
export function stepsFromStreamLine(line: string): Step[] {
  let message: unknown;
  try {
    message = JSON.parse(line);
  } catch {
    return [];
  }
  if (!isRecord(message) || message.type !== 'assistant' || !isRecord(message.message)) return [];
  const content = message.message.content;
  if (!Array.isArray(content)) return [];
  const steps: Step[] = [];
  for (const block of content) {
    if (!isRecord(block)) continue;
    if (block.type === 'tool_use' && block.name === 'Bash' && isRecord(block.input) && typeof block.input.command === 'string') {
      const label = stepForCommand(block.input.command);
      if (label) steps.push({ kind: 'step', content: label });
    } else if (block.type === 'text' && typeof block.text === 'string') {
      const step = textStep(block.text);
      if (step) steps.push(step);
    }
  }
  return steps;
}

/** The final `result` line, if this is it: whether Claude reported an error. */
export function resultOf(line: string): { isError: boolean; text: string } | null {
  try {
    const message = JSON.parse(line) as unknown;
    if (!isRecord(message) || message.type !== 'result') return null;
    return { isError: message.is_error === true || (typeof message.subtype === 'string' && message.subtype !== 'success'), text: typeof message.result === 'string' ? message.result : '' };
  } catch {
    return null;
  }
}

/** Wording that means Claude Code itself needs the owner: signed out, or out of usage. */
export function needsAttention(text: string): boolean {
  return /not logged in|please run \/login|\/login to|invalid api key|authentication_error|oauth token|usage limit|limit reached|out of (?:extra )?usage|credit balance is too low/i.test(text);
}
