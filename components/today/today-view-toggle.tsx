'use client';

import { useSyncExternalStore } from 'react';
import { LayoutGrid, Newspaper } from 'lucide-react';
import { readTodayView, TODAY_VIEW_KEY, type TodayView } from '@/lib/home/today-view';

// Today's view (Classic or Glass), shared by the page and the button that
// switches it. The button sits in a header (the desktop's top bar, or Today's
// own on the phone), so the choice lives here rather than in either.
// Read from storage on first use in the browser; the server, and the first
// render that hydrates its HTML, are always Classic.
let current: TodayView | undefined;
const listeners = new Set<() => void>();

function read(): TodayView {
  if (current === undefined) {
    try {
      current = readTodayView(window.localStorage.getItem(TODAY_VIEW_KEY));
    } catch {
      // Storage blocked (a private window): Classic.
      current = 'classic';
    }
  }
  return current;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function setTodayView(next: TodayView) {
  current = next;
  try {
    window.localStorage.setItem(TODAY_VIEW_KEY, next);
  } catch {
    // Storage blocked: the choice holds for this visit only.
  }
  for (const listener of listeners) listener();
}

/** The Today view the person chose; Classic on the server and while hydrating. */
export function useTodayView(): TodayView {
  return useSyncExternalStore(subscribe, read, () => 'classic');
}

/** One small header button: flips Today between Classic and Glass, showing the view it switches to. */
export function TodayViewToggle() {
  const view = useTodayView();
  const glass = view === 'glass';
  const label = glass ? 'Switch to Classic view' : 'Switch to Glass view';
  return (
    <button type="button" className="icon-btn" aria-pressed={glass} aria-label="Glass view" title={label} onClick={() => setTodayView(glass ? 'classic' : 'glass')}>
      {glass ? <Newspaper size={18} aria-hidden="true" /> : <LayoutGrid size={18} aria-hidden="true" />}
    </button>
  );
}
