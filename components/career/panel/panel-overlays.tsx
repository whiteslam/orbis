'use client';

import { useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { PasteJob } from '@/components/career/for-you-view';
import { QueueView } from '@/components/career/queue-view';
import { useDialogFocus } from '@/components/career/panel/panel-bits';
import type { ApplicationCard, CareerHome } from '@/lib/career/view';

/** A right-hand drawer over a scrim, for lists that aren't a job (the queue). */
function SideDrawer({ title, onClose, children }: Readonly<{ title: string; onClose: () => void; children: ReactNode }>) {
  const box = useRef<HTMLDivElement | null>(null);
  useDialogFocus(box, onClose);
  return (
    <>
      <div className="cp-scrim" aria-hidden="true" onClick={onClose} />
      <div className="cp-side field" ref={box} role="dialog" aria-modal="true" aria-labelledby="cp-side-title">
        <header className="cp-side-head">
          <h2 id="cp-side-title">{title}</h2>
          <button type="button" className="fd-round" onClick={onClose} aria-label="Close"><X size={16} strokeWidth={2.2} aria-hidden="true" /></button>
        </header>
        {children}
      </div>
    </>
  );
}

/** The approval queue (the tab's Queue view) as a drawer, opened from the rail. */
export function QueueDrawer({ home, threshold, onOpen, onClose }: Readonly<{ home: CareerHome; threshold: number | null; onOpen: (card: ApplicationCard) => void; onClose: () => void }>) {
  return (
    <SideDrawer title="Ready for your Send" onClose={onClose}>
      <QueueView queue={home.queue} followUps={home.followUps} threshold={threshold} onOpen={onOpen} />
    </SideDrawer>
  );
}

/** "Paste a job" (the tab's own form) in a centred dialog. */
export function PasteDialog({ onPasted, onClose }: Readonly<{ onPasted: (jobId: string) => void; onClose: () => void }>) {
  const box = useRef<HTMLDivElement | null>(null);
  useDialogFocus(box, onClose);
  return (
    <div className="cp-veil" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="cp-modal field" ref={box} role="dialog" aria-modal="true" aria-labelledby="cr-paste-title">
        <PasteJob onPasted={onPasted} onClose={onClose} />
      </div>
    </div>
  );
}

export type Toast = { text: string; ok: boolean; busy: boolean };

/** Long actions from the rail (search, export) report here: progress while running, the outcome after. */
export function StatusToast({ toast, onDismiss }: Readonly<{ toast: Toast | null; onDismiss: () => void }>) {
  return (
    <output className={`cp-toast${toast ? ' on' : ''}${toast && !toast.ok ? ' bad' : ''}`}>
      {toast && (
        <>
          <span className="cp-toast-text">{toast.text}</span>
          {toast.busy ? <span className="cr-progress-bar indeterminate cp-toast-bar" aria-hidden="true"><i /></span> : (
            <button type="button" className="fd-link" onClick={onDismiss}>Dismiss</button>
          )}
        </>
      )}
    </output>
  );
}
