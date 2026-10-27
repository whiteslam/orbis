'use client';

import { useEffect, useState } from 'react';
import { loadSetupAction } from '@/app/career/actions';
import { Block, NoticeLine } from '@/components/career/bits';
import { SetupProfile } from '@/components/career/setup/setup-profile';
import { SetupResume } from '@/components/career/setup/setup-resume';
import { SetupGmail, SetupNumbers, SetupSources } from '@/components/career/setup/setup-settings';
import { SetupSpec } from '@/components/career/setup/setup-spec';
import { useRun } from '@/components/career/use-run';
import type { CareerProfile, CareerSettings, CareerSpec } from '@/lib/career/types';
import type { CareerSetup } from '@/lib/career/view';

const SECTIONS = [['resume', 'Resume'], ['profile', 'Profile'], ['spec', 'Spec'], ['sources', 'Sources'], ['settings', 'Settings'], ['gmail', 'Gmail']] as const;

function jumpTo(id: string) {
  document.getElementById(`cr-setup-${id}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

/**
 * Setup, in the order a first sitting takes: the resume, the profile it
 * became, the spec, then sources, settings and Gmail.
 */
export function SetupView({ initial, gmail, onChanged }: Readonly<{
  /** From the home load; when absent, Setup loads its own. */
  initial: CareerSetup | null;
  gmail: { connected: boolean; canSend: boolean } | null;
  /** Something saved: the tab re-reads its home. */
  onChanged: (patch: Partial<CareerSetup>) => void;
}>) {
  const [setup, setSetup] = useState<CareerSetup | null>(initial);
  const { busy, notice, run } = useRun();

  useEffect(() => {
    if (initial) return;
    void run('load', () => loadSetupAction(), setSetup);
  }, [initial, run]);

  const patch = (next: Partial<CareerSetup>) => {
    setSetup((current) => (current ? { ...current, ...next } : current));
    onChanged(next);
  };

  if (!setup) {
    return (
      <div className="cr-view">
        {busy === 'load' && <p className="fd-empty">Loading Setup…</p>}
        <NoticeLine notice={notice} />
      </div>
    );
  }

  return (
    <div className="cr-view cr-setup">
      {/* Not a <nav>: the bottom nav stays the only navigation landmark. */}
      <fieldset className="settings-jump cr-jump" aria-label="Setup sections">
        {SECTIONS.map(([id, label]) => <button key={id} type="button" onClick={() => jumpTo(id)}>{label}</button>)}
      </fieldset>

      <Block id="cr-setup-resume" title="Resume" className="mn-card" note="Kept on file. Orbis reads it into a profile of roles, facts and skills, and tailors from that alone.">
        <SetupResume fileName={setup.resumeFileName} onProfile={(profile: CareerProfile, fileName: string) => patch({ profile, resumeFileName: fileName })} />
      </Block>

      <Block id="cr-setup-profile" title="Profile" className="mn-card" note="Every tailored line cites these facts. Edit anything that’s off; an edit counts as confirmed.">
        {setup.profile
          ? <SetupProfile key={setup.resumeFileName ?? 'none'} profile={setup.profile} onSaved={(profile) => patch({ profile })} />
          : <p className="fd-empty">Upload your resume first. Your profile appears here to check.</p>}
      </Block>

      <Block id="cr-setup-spec" title="Spec" className="mn-card" note="The jobs you want. Orbis searches and scores against this.">
        <SetupSpec spec={setup.spec} onSaved={(spec: CareerSpec) => patch({ spec })} />
      </Block>

      <Block id="cr-setup-sources" title="Sources" className="mn-card" note="Where Orbis looks. LinkedIn, Indeed and Naukri are read only from your own alert emails, never scraped.">
        <SetupSources settings={setup.settings} onSaved={(settings: CareerSettings) => patch({ settings })} />
      </Block>

      <Block id="cr-setup-settings" title="Settings" className="mn-card">
        <SetupNumbers settings={setup.settings} onSaved={(settings: CareerSettings) => patch({ settings })} />
      </Block>

      <Block id="cr-setup-gmail" title="Gmail" className="mn-card">
        {gmail ? <SetupGmail gmail={gmail} /> : <p className="fd-empty">The Gmail connection couldn’t be read. Check it in Settings.</p>}
      </Block>
    </div>
  );
}
