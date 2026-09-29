'use client';

import { useEffect, useState } from 'react';
import { useSettings } from '@/components/shell/settings-context';
import type { SetupStep } from '@/lib/focus/setup';

const HIDDEN_KEY = 'orbis.setupChecklist.hidden';

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

  return (
    <section className="fd-quiet setup-list" aria-label="Set up Orbis">
      <h2>Set up Orbis</h2>
      {steps.map((step) => (
        <button key={step.id} className="fd-line" type="button" onClick={() => settings.open(step.section)}>
          <span>{step.label}</span>
          <b className="fd-yes">Open</b>
        </button>
      ))}
      <div className="fd-act"><button type="button" onClick={hide}>Hide</button></div>
    </section>
  );
}
