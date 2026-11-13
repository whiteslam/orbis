/** Which Today the person last chose on the desktop: today's layout or the Glass one. */
export const TODAY_VIEW_KEY = 'orbis.today.view';

export type TodayView = 'classic' | 'glass';

/** Anything but an exact 'glass' (missing, blocked storage, old junk) is Classic. */
export function readTodayView(raw: string | null): TodayView {
  return raw === 'glass' ? 'glass' : 'classic';
}
