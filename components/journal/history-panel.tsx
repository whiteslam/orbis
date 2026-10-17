'use client';

import { useEffect, useRef, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { LoaderCircle } from 'lucide-react';
import { historyTime } from '@/lib/history/describe';

export type HistoryRow = {
  id: string;
  createdAt: string;
  line: string;
  /** The text as it was before this change, shown on request. */
  before?: string | null;
  /** Brings this version back as a new edit. Absent where there is nothing to restore. */
  restore?: () => Promise<{ success: boolean; message: string }>;
  restoreLabel?: string;
};

/**
 * A list of past changes, loaded when opened.
 *
 * Shared by journal entries and saved notes. Restoring never rewrites history:
 * it saves the old version as a new edit, which then appears at the top.
 */
export function HistoryPanel({ title, load, empty }: Readonly<{
  title: string;
  load: () => Promise<{ success: boolean; message: string; rows: HistoryRow[] }>;
  empty: string;
}>) {
  const router = useRouter();
  const [rows, setRows] = useState<HistoryRow[] | null>(null);
  const [message, setMessage] = useState<{ text: string; success: boolean } | null>(null);
  const [opened, setOpened] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [reload, setReload] = useState(0);
  // Callers pass a fresh `load` on every render; the latest one is used, and
  // only opening the panel or restoring a version triggers a reload.
  const latestLoad = useRef(load);
  useEffect(() => { latestLoad.current = load; });

  useEffect(() => {
    let live = true;
    void latestLoad.current().then((result) => {
      if (!live) return;
      setRows(result.rows);
      if (!result.success) setMessage({ text: result.message, success: false });
    });
    return () => { live = false; };
  }, [reload]);

  function restore(row: HistoryRow) {
    if (!row.restore) return;
    const run = row.restore;
    startTransition(async () => {
      const result = await run();
      setMessage({ text: result.message, success: result.success });
      if (result.success) {
        router.refresh();
        setReload((value) => value + 1);
      }
    });
  }

  let body: ReactNode;
  if (rows === null) {
    body = <p className="hs-loading"><LoaderCircle className="workbook-spinner" size={13} aria-hidden="true" /> Loading…</p>;
  } else if (rows.length) {
    body = (
      <ol className="hs-list">
        {rows.map((row) => (
          <li key={row.id}>
            <div className="hs-row">
              <span><time dateTime={row.createdAt}>{historyTime(row.createdAt)}</time>{row.line}</span>
              <span className="hs-actions">
                {row.before ? <button type="button" className="fd-link" aria-expanded={opened === row.id} onClick={() => setOpened(opened === row.id ? null : row.id)}>{opened === row.id ? 'Hide' : 'Before'}</button> : null}
                {row.restore ? <button type="button" className="fd-link" disabled={isPending} onClick={() => restore(row)}>{row.restoreLabel ?? 'Restore'}</button> : null}
              </span>
            </div>
            {opened === row.id && row.before ? <p className="hs-before">{row.before}</p> : null}
          </li>
        ))}
      </ol>
    );
  } else {
    body = <p className="hs-empty">{empty}</p>;
  }

  return (
    <section className="hs-panel" aria-label={title}>
      <p className="hs-title">{title}</p>
      {body}
      {message && <output className={`fd-msg ${message.success ? 'ok' : 'bad'}`}>{message.text}</output>}
    </section>
  );
}
