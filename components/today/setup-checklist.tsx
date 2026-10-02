'use client';

import { useEffect, useState } from 'react';
import { ChevronRight, Clock, Mail, Sparkles, UserRound, X, type LucideIcon } from 'lucide-react';
import { useSettings } from '@/components/shell/settings-context';
import type { SetupStep } from '@/lib/focus/setup';

const HIDDEN_KEY = 'orbis.setupChecklist.hidden';

const ICONS: Record<SetupStep['id'], LucideIcon> = { name: UserRound, ai: Sparkles, google: Mail, day: Clock };

function readHidden() {
  try {
    return window.localStorage.getItem(HIDDEN_KEY) === '1';
  } catch {
    return false;
  }
}

/** What is left to set up, each row opening the Settings section that does it. Hidden for good on this device with "Hide". */
export function SetupChecklist({ steps }: { steps: SetupStep[] }) {
  const settings = useSettings();
  // Starts hidden so the server render and the first client render agree; the
  // saved choice is read after mount.
  const [hidden, setHidden] = useState(true);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setHidden(readHidden()), []);

  if (hidden || !steps.length || !settings) return null;

  function hide() {
    setHidden(true);
    try {
      window.localStorage.setItem(HIDDEN_KEY, '1');
    } catch {
      // Private mode or blocked storage: hidden for this visit only.
    }
  }

  // One line, however many steps are left: the next step, a count, and a way
  // out. Finishing a step brings the next one up, so the list never needs room.
  const next = steps[0];
  const Icon = ICONS[next.id];
  return (
    <section className="setup-list" aria-label="Set up Orbis">
      <button className="setup-row" type="button" onClick={() => settings.open(next.section)}>
        <span className="fd-tile" aria-hidden="true"><Icon size={15} strokeWidth={1.9} /></span>
        <span className="setup-row-label">
          {next.label}
          <small>Set up Orbis · {steps.length === 1 ? 'last step' : `${steps.length} steps left`}</small>
        </span>
        <ChevronRight size={15} strokeWidth={2.2} aria-hidden="true" />
      </button>
      <button className="fd-round" type="button" onClick={hide} aria-label="Hide setup" title="Hide"><X size={14} strokeWidth={2.2} aria-hidden="true" /></button>
    </section>
  );
}
