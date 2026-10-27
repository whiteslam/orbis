/**
 * When the app switches from the phone layout to the desktop one. Pure, so the
 * shell can share it and the greeting is tested rather than remembered.
 */

import { partOfDay } from '@/lib/home/note';

/**
 * The desktop breakpoint. app/styles/desktop.css repeats it word for word in
 * its media queries (CSS can't import it); change both together. The second
 * clause keeps a short touch screen (a phone on its side, which the phone
 * layout claims with `(pointer: coarse) and (max-height: 540px)`) out of it.
 */
export const DESKTOP_QUERY = '(min-width: 1100px) and (pointer: fine), (min-width: 1100px) and (min-height: 541px)';

/**
 * Whether this build ships the desktop layout at all. Off until it is finished
 * (docs/superpowers/plans/2026-10-27-web-desktop.md): turn it on with
 * NEXT_PUBLIC_DESKTOP_LAYOUT=1. Inlined at build time, so the server and the
 * browser agree and rendering on it causes no hydration mismatch.
 */
export const DESKTOP_LAYOUT = process.env.NEXT_PUBLIC_DESKTOP_LAYOUT === '1';

/** Whether the desktop layout is showing. For event handlers only: never branch a render on it. */
export function isDesktop(): boolean {
  return DESKTOP_LAYOUT && typeof window !== 'undefined' && window.matchMedia(DESKTOP_QUERY).matches;
}

/** The header's hello, by the hour in India. Late at night it stays "evening"; before five it is a plain hello. */
export function greeting(hour: number, name: string | null): string {
  const part = partOfDay(hour);
  const words = part === 'early' ? 'Hello' : `Good ${part === 'night' ? 'evening' : part}`;
  const who = name?.trim();
  return who ? `${words}, ${who}` : words;
}
