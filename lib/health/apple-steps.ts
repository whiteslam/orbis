// Parses step samples out of an Apple Health `export.xml` stream and folds them into daily totals.
// Pure (no DOM, no server APIs) so it runs in a Web Worker and in unit tests.

const STEP_MARKER = 'type="HKQuantityTypeIdentifierStepCount"';
const HOUR_MS = 3_600_000;

export type StepSample = { source: string; start: string; end: string; value: number };
export type DailySteps = { date: string; steps: number };
export type StepImportResult = { days: DailySteps[]; recordCount: number; firstDate: string | null; lastDate: string | null };

function attribute(tag: string, name: string) {
  const match = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
  return match ? match[1] : null;
}

// Scans one text chunk (plus any partial tag carried from the previous chunk) for step records.
export function scanStepRecords(chunk: string, carry: string): { samples: StepSample[]; carry: string } {
  const text = carry + chunk;
  const samples: StepSample[] = [];
  let from = 0;
  for (;;) {
    const markerAt = text.indexOf(STEP_MARKER, from);
    if (markerAt === -1) break;
    const tagStart = text.lastIndexOf('<', markerAt);
    const tagEnd = text.indexOf('>', markerAt);
    if (tagEnd === -1) return { samples, carry: text.slice(tagStart === -1 ? markerAt : tagStart) };
    from = tagEnd + 1;
    const tag = text.slice(tagStart, tagEnd + 1);
    if (!tag.startsWith('<Record')) continue;
    const source = attribute(tag, 'sourceName');
    const start = attribute(tag, 'startDate');
    const end = attribute(tag, 'endDate');
    const value = Number(attribute(tag, 'value'));
    if (source !== null && start && end && Number.isFinite(value) && value >= 0) samples.push({ source, start, end, value });
  }
  // Keep a trailing tag that hasn't closed yet; it may be a step record split across chunks.
  const lastOpen = text.lastIndexOf('<');
  return { samples, carry: lastOpen !== -1 && text.indexOf('>', lastOpen) === -1 ? text.slice(lastOpen) : '' };
}

// Apple writes dates as "2026-09-21 08:12:03 +0530". Returns the wall-clock time as if it were UTC,
// plus the real instant, so days line up with what the Health app shows in the local timezone.
export function parseAppleDate(value: string): { local: number; instant: number } | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2}) ?([+-])(\d{2}):?(\d{2})$/);
  if (!match) return null;
  const [, y, mo, d, h, mi, s, sign, oh, om] = match;
  const local = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  const offset = (Number(oh) * 60 + Number(om)) * 60_000 * (sign === '-' ? -1 : 1);
  return Number.isNaN(local) ? null : { local, instant: local - offset };
}

export class StepAggregator {
  // hour bucket (local wall clock) → source → steps
  private hours = new Map<number, Map<string, number>>();
  recordCount = 0;

  add(sample: StepSample) {
    const start = parseAppleDate(sample.start);
    const end = parseAppleDate(sample.end);
    if (!start || !end) return;
    this.recordCount += 1;
    const duration = Math.max(0, end.instant - start.instant);
    const localEnd = start.local + duration;
    const firstHour = Math.floor(start.local / HOUR_MS);
    const lastHour = duration === 0 ? firstHour : Math.floor((localEnd - 1) / HOUR_MS);
    for (let hour = firstHour; hour <= lastHour; hour += 1) {
      const overlap = duration === 0 ? 1 : (Math.min(localEnd, (hour + 1) * HOUR_MS) - Math.max(start.local, hour * HOUR_MS)) / duration;
      let sources = this.hours.get(hour);
      if (!sources) this.hours.set(hour, (sources = new Map()));
      sources.set(sample.source, (sources.get(sample.source) ?? 0) + sample.value * overlap);
    }
  }

  // iPhone and Apple Watch both record the same walking, so summing every sample double-counts.
  // Within each hour, keep the source that counted the most, which approximates Apple's source priority.
  result(): StepImportResult {
    const totals = new Map<string, number>();
    for (const [hour, sources] of this.hours) {
      const date = new Date(hour * HOUR_MS).toISOString().slice(0, 10);
      totals.set(date, (totals.get(date) ?? 0) + Math.max(...sources.values()));
    }
    const days = [...totals].map(([date, steps]) => ({ date, steps: Math.round(steps) })).sort((a, b) => a.date.localeCompare(b.date));
    return { days, recordCount: this.recordCount, firstDate: days[0]?.date ?? null, lastDate: days.at(-1)?.date ?? null };
  }
}
