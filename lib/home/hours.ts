export type HourTemp = { hour: string; temperature: number };

/** "2026-09-25T21:00" → "9 pm", the hour a forecast actually refers to. */
export function hourLabel(iso: string) {
  const hour = Number(iso.slice(11, 13));
  if (!Number.isFinite(hour)) return iso;
  if (hour === 0) return 'midnight';
  if (hour === 12) return 'noon';
  return hour < 12 ? `${hour} am` : `${hour - 12} pm`;
}

/**
 * The next hours of a forecast, from the current hour on. `nowHour` is
 * "YYYY-MM-DDTHH" in the forecast's own time zone. Hours with no usable
 * temperature are skipped rather than drawn as zero.
 */
export function nextHours(
  times: string[],
  temps: Array<number | null | undefined>,
  nowHour: string,
  count = 12,
): HourTemp[] {
  const out: HourTemp[] = [];
  for (let i = 0; i < times.length && out.length < count; i++) {
    const time = times[i];
    const temp = temps[i];
    if (time.slice(0, 13) < nowHour) continue;
    if (typeof temp !== 'number' || !Number.isFinite(temp)) continue;
    out.push({ hour: hourLabel(time), temperature: Math.round(temp) });
  }
  return out;
}

/**
 * Screen points for a temperature curve: x evenly spread, y inverted so the
 * warmest hour is highest. Fewer than two hours is no curve at all.
 */
export function curvePoints(hours: HourTemp[], width: number, height: number, pad = 6): Array<{ x: number; y: number }> {
  if (hours.length < 2) return [];
  const temps = hours.map((h) => h.temperature);
  const min = Math.min(...temps);
  const max = Math.max(...temps);
  const span = max - min;
  const step = (width - pad * 2) / (hours.length - 1);
  return hours.map((h, i) => ({
    x: pad + i * step,
    y: span === 0 ? height / 2 : pad + (1 - (h.temperature - min) / span) * (height - pad * 2),
  }));
}

/** Evenly spaced hours to label under the curve, always including the first and last. */
export function curveLabels(hours: HourTemp[], count = 4): HourTemp[] {
  if (hours.length <= count) return hours;
  const last = hours.length - 1;
  return Array.from({ length: count }, (_, i) => hours[Math.round((i * last) / (count - 1))]);
}
