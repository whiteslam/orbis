// Checks on what the build left in the project folder, before anything is uploaded.

export type DeliveryText = { title: string; caption: string; hashtags: string[]; qa: string[] };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const strings = (value: unknown, max: number, length: number) => (Array.isArray(value) ? value : [])
  .filter((item): item is string => typeof item === 'string' && item.trim() !== '')
  .map((item) => item.trim().slice(0, length))
  .slice(0, max);

/** delivery.json → its text fields, or null when it isn't usable. */
export function readDelivery(text: string): DeliveryText | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(raw) || typeof raw.title !== 'string' || !raw.title.trim()) return null;
  return {
    title: raw.title.trim().slice(0, 120),
    caption: typeof raw.caption === 'string' ? raw.caption.trim().slice(0, 2200) : '',
    hashtags: strings(raw.hashtags, 12, 50).map((tag) => tag.replace(/\s+/g, '')).map((tag) => (tag.startsWith('#') ? tag : `#${tag}`)),
    qa: strings(raw.qa, 30, 300),
  };
}

/** `ffprobe -print_format json -show_streams -show_format` → a vertical 1080x1920 video of 20–70 s. */
export function checkProbe(probeJson: string): { ok: true; seconds: number } | { ok: false; reason: string } {
  let probe: unknown;
  try {
    probe = JSON.parse(probeJson);
  } catch {
    return { ok: false, reason: 'The video couldn’t be read.' };
  }
  if (!isRecord(probe)) return { ok: false, reason: 'The video couldn’t be read.' };
  const streams = Array.isArray(probe.streams) ? probe.streams.filter(isRecord) : [];
  const video = streams.find((stream) => stream.codec_type === 'video');
  if (!video) return { ok: false, reason: 'The file has no video.' };
  if (video.width !== 1080 || video.height !== 1920) return { ok: false, reason: `The video is ${String(video.width)}x${String(video.height)}, not 1080x1920.` };
  const format = isRecord(probe.format) ? probe.format : {};
  const seconds = Number(format.duration ?? video.duration);
  if (!Number.isFinite(seconds) || seconds < 20 || seconds > 70) return { ok: false, reason: `The video is ${Number.isFinite(seconds) ? seconds.toFixed(1) : '?'} s long (20–70 s expected).` };
  return { ok: true, seconds: Math.round(seconds * 10) / 10 };
}
