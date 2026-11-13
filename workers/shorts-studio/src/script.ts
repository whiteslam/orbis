// The approved plan → the project's script.json, done by the worker itself
// (no AI): the owner's edits are exactly what gets voiced and captioned.

import type { ShortPlan } from '../../../lib/shorts/plan.ts';
import type { ShortOptions } from '../../../lib/shorts/types.ts';

type ScriptLine = { text: string; caps?: string; gap?: number };

export function applyPlanToScript(scriptJson: string, plan: ShortPlan, options: ShortOptions): string {
  const script = JSON.parse(scriptJson) as Record<string, unknown>;
  const before = Array.isArray(script.lines) ? (script.lines as ScriptLine[]) : [];
  // A per-line pause only still fits when the lines are the same ones.
  const sameShape = before.length === plan.lines.length;
  script.title = plan.title;
  script.voice = options.voice;
  script.music = options.music;
  if (options.mode === 'captions') script.mode = 'captions';
  else delete script.mode;
  if (plan.sources.length) script.sources = plan.sources;
  script.lines = plan.lines.map((line, index) => {
    const next: ScriptLine = { text: line.text, caps: line.caps };
    const gap = sameShape ? before[index]?.gap : undefined;
    if (typeof gap === 'number') next.gap = gap;
    return next;
  });
  return `${JSON.stringify(script, null, 2)}\n`;
}
