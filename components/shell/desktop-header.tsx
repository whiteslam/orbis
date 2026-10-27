'use client';

import { useCallback, useRef, useState, useSyncExternalStore } from 'react';
import { Bell, Search } from 'lucide-react';
import { OrbisMark } from '@/components/brand/orbis-mark';
import { useDismiss } from '@/components/career/panel/panel-bits';
import { SettingsButton } from '@/components/shell/settings-context';
import { ThemeToggle } from '@/components/theme-toggle';
import { Headsups } from '@/components/today/headsups';
import { istParts } from '@/lib/focus/types';
import type { HeadsupAction } from '@/lib/headsups/types';
import { greeting } from '@/lib/shell/desktop';

const noSubscribe = () => () => {};

/** "⌘" on a Mac, "Ctrl" elsewhere; "Ctrl" on the server, corrected on the client without a mismatch. */
function useModKey() {
  return useSyncExternalStore(noSubscribe, () => (/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'), () => 'Ctrl');
}

/** What Orbis noticed, in a popover under the bell. It loads when opened, so the phone never pays for it. */
function HeadsupsButton({ onAction }: Readonly<{ onAction: (action: HeadsupAction) => void }>) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement | null>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, box, close);
  return (
    <div className="cp-pop-wrap" ref={box}>
      <button type="button" className="cp-head-btn" aria-expanded={open} aria-controls="dk-headsups" onClick={() => setOpen((value) => !value)} title="Heads-ups">
        <Bell size={18} aria-hidden="true" />
        <span className="sr-only">Heads-ups</span>
      </button>
      {open && (
        <div className="cp-pop dk-pop" id="dk-headsups" role="dialog" aria-label="Heads-ups">
          <Headsups onAction={(action) => { setOpen(false); onAction(action); }} empty="Nothing needs you right now. Orbis tells you here when something does." />
        </div>
      )}
    </div>
  );
}

/**
 * The desktop's top bar: hello and the date on the left, search (Ctrl/⌘+K) in
 * the middle, then heads-ups, the appearance switch and the avatar that opens
 * Settings. Hidden by app/styles/desktop.css below the breakpoint, where each
 * screen's own header does this job.
 */
export function DesktopHeader({ name, onSearch, onHeadsup }: Readonly<{
  name: string | null;
  onSearch: () => void;
  onHeadsup: (action: HeadsupAction) => void;
}>) {
  const mod = useModKey();
  const now = new Date();
  const today = now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' });
  return (
    <header className="dk-header">
      {/* The hour and the date are India's on both sides, but either can turn between them. */}
      <div className="dk-hello">
        <OrbisMark size={34} />
        <p suppressHydrationWarning><b suppressHydrationWarning>{greeting(istParts(now).hour, name)}</b><small suppressHydrationWarning>{today}</small></p>
      </div>
      <button type="button" className="dk-search" onClick={onSearch} aria-keyshortcuts="Control+K Meta+K">
        <Search size={17} aria-hidden="true" />
        <span>Search Orbis</span>
        <kbd aria-hidden="true">{mod} K</kbd>
      </button>
      <div className="dk-tools">
        <HeadsupsButton onAction={onHeadsup} />
        <ThemeToggle />
        <SettingsButton />
      </div>
    </header>
  );
}
