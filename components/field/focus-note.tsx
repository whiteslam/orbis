'use client';

import { CloudSun, HeartPulse, Mail, Orbit, TrendingUp, type LucideIcon } from 'lucide-react';
import type { SourceId } from '@/lib/focus/types';
import type { HomeNote } from '@/lib/home/note';

// Split out of field.tsx, and it has to stay split. field.tsx is imported by the
// error boundary, and an error boundary is bundled into every route including the
// public waitlist, so this module's contents would be downloaded by strangers.
// The map below is a list of every service Orbis reads from: read it in the
// Network tab and you know what the app connects to without ever signing in.
// Anything naming a provider belongs here, behind a signed-in screen, not there.

/**
 * The mark printed beside a card's source line, so where a number came from is
 * readable at a glance and not only in the wording.
 *
 * These are plain glyphs standing for the kind of service. Orbis ships one real
 * brand file (Groww) and does not reproduce anyone else's logo here.
 */
const SOURCE_MARK: Record<SourceId, { icon: LucideIcon; label: string }> = {
  'open-meteo': { icon: CloudSun, label: 'Open-Meteo' },
  gmail: { icon: Mail, label: 'Gmail' },
  'apple-health': { icon: HeartPulse, label: 'Apple Health' },
  groww: { icon: TrendingUp, label: 'Groww' },
  orbis: { icon: Orbit, label: 'Orbis' },
};

/**
 * The Home brief, as a short note in Orbis's own voice.
 *
 * This replaced a swipeable deck of tinted cards — icon, headline, chip row of
 * measurements, button, source footer, four of them abreast. Every true thing
 * had to be cut to fit that box, and a reading of your morning came out looking
 * like a dashboard. Sentences carry the same facts and read as written.
 *
 * It sits on the ground with no fill, no border and no shadow, like every other
 * statement in this layout.
 */
export function FocusNote({ note }: { note: HomeNote }) {
  return (
    <section className="fd-note-brief" aria-label="Your brief">
      {/* The greeting and the day both depend on the hour, which can differ
          between the server render and the browser's. */}
      <p className="fd-note-greet" suppressHydrationWarning>
        {note.greeting}
        <time className="fd-note-time" suppressHydrationWarning>{note.time}</time>
      </p>
      <p className="fd-note-line" suppressHydrationWarning>{note.caption}</p>
      {note.sources.length > 0 && (
        <p className="fd-note-from">
          {note.sources.map((id) => {
            const mark = SOURCE_MARK[id];
            const MarkIcon = mark.icon;
            return <span key={id}><MarkIcon size={11} strokeWidth={2} aria-hidden="true" />{mark.label}</span>;
          })}
        </p>
      )}
    </section>
  );
}
