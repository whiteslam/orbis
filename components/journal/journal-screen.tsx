'use client';

import { FieldHead } from '@/components/field/field';
import { ContextNotes } from '@/components/journal/context-notes';
import { Journal } from '@/components/journal/journal';
import type { JournalSummary } from '@/lib/journal/types';
import type { ContextNote } from '@/lib/memory/notes';

/** Today's entry and its history, and the notes you asked Orbis to remember. */
export function JournalScreen({ journal, contextNotes }: Readonly<{ journal: JournalSummary; contextNotes: { ready: boolean; notes: ContextNote[] } }>) {
  return (
    <div className="screen-body field pf-screen jr-screen">
      <FieldHead title="Journal" />
      <Journal
        journal={journal}
        notes={(
          <section className="jr-notes" aria-label="Saved notes">
            <h2 className="jr-h">Saved notes</h2>
            <p className="jr-sub">Anything you asked Orbis to remember: a constraint, a preference, something you are saving for.</p>
            <ContextNotes ready={contextNotes.ready} notes={contextNotes.notes} />
          </section>
        )}
      />
    </div>
  );
}
