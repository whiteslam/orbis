'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import dynamic from 'next/dynamic';

// Loaded in the browser only, after the page is up. The shader is the heaviest
// thing on a public page whose first open is held to a JS budget, and the form
// and the copy must not wait for it. `ssr: false` is only allowed in a client
// component, which is why this wrapper exists.
const BlackHole = dynamic(
  () => import('@/components/ui/blackhole-hero-section').then((m) => m.BlackHoleHeroSection),
  { ssr: false, loading: () => null },
);

/** True while the viewport is narrow. Drives the layout swap below. */
function useNarrow(query = '(max-width: 767px)') {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const m = globalThis.matchMedia(query);
    const sync = () => setNarrow(m.matches);
    sync();
    m.addEventListener('change', sync);
    return () => m.removeEventListener('change', sync);
  }, [query]);
  return narrow;
}

type Tier = 'normal' | 'light';

/**
 * Picks how hard to draw. The shader marches a ray per pixel, so what a
 * visitor's device can bear decides whether this is a picture or a stutter.
 * Few cores, little memory or a data-saver request all mean the light tier.
 * Anything this guesses wrong is caught by the scene's own frame-time check,
 * which steps quality down further on its own.
 */
function useTier(narrow: boolean): Tier {
  const weak = useSyncExternalStore(subscribeNever, isWeakDevice, () => false);
  return weak || narrow ? 'light' : 'normal';
}

// Device hints do not change while the page is open, so there is nothing to
// subscribe to. useSyncExternalStore is just the way to read them without a
// server/client mismatch: the server snapshot is `false`.
const subscribeNever = () => () => {
  // Nothing was subscribed, so there is nothing to undo.
};

function isWeakDevice(): boolean {
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  return (
    (nav.hardwareConcurrency ?? 8) <= 4 ||
    (nav.deviceMemory ?? 8) <= 4 ||
    nav.connection?.saveData === true
  );
}

/**
 * The picture behind the waitlist hero. Decorative, so it is hidden from
 * assistive tech and sits under the copy.
 *
 * Beside the copy on a wide screen: the hole is pushed right and the veil is
 * on the left edge, where the words are. A phone has no room for that, so it
 * turns through 90°: copy on top under a veil from the top edge, the hole low
 * and whole beneath it.
 *
 * The disc is coloured from the Orbis mark: icy teal at the hot inner rim,
 * sky blue through the middle, indigo-violet at the cool outer edge.
 */
export function WaitlistBackdrop() {
  const narrow = useNarrow();
  const light = useTier(narrow) === 'light';
  return (
    <div className="wl-backdrop" aria-hidden="true">
      <BlackHole
        focus={narrow ? [0.5, 0.86] : [0.74, 0.5]}
        scrim={narrow ? 'top' : 'left'}
        scrimStrength={0.9}
        distance={24}
        elevation={narrow ? -7 : -5.5}
        fov={narrow ? 58 : 42}
        hotColor="#E4FCFF"
        midColor="#5BB4E8"
        coolColor="#2F8F8A"
        doppler={0.2}
        glow={narrow ? 0.85 : 1}
        steps={light ? 150 : 220}
        resolution={light ? 0.42 : 0.55}
        maxDpr={light ? 1 : 1.25}
        maxFps={light ? 24 : 30}
      />
    </div>
  );
}
