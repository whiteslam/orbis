'use client';

import { useId, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Download, FileSpreadsheet, FileText, LoaderCircle, Pin, Trash2, Upload } from 'lucide-react';
import { deleteHealthDocumentAction, downloadHealthDocumentAction, setHealthDocumentAlwaysAction, uploadHealthDocumentAction } from '@/app/health/library-actions';
import type { HealthDocument } from '@/lib/health-docs/types';
import { FieldHero, FieldLabel } from '@/components/field/field';
import { safeAction } from '@/lib/client/safe-action';

export function documentSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function documentAdded(value: string) {
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(new Date(value));
}

/** The body of the Documents view: how many there are, the upload box, and each saved file. */
export function HealthLibrary({ documents, state }: { documents: HealthDocument[]; state: 'ready' | 'setup' | 'unavailable' }) {
  const inputId = useId();
  const router = useRouter();
  const [message, setMessage] = useState<{ text: string; success: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function upload(file: File) {
    setMessage(null);
    setBusy('upload');
    const formData = new FormData();
    formData.set('document', file);
    startTransition(async () => {
      const result = await safeAction(uploadHealthDocumentAction)(formData);
      setMessage({ text: result.success ? result.message ?? 'Saved.' : result.message, success: result.success });
      setBusy(null);
      if (result.success) router.refresh();
    });
  }

  function toggleAlways(document: HealthDocument) {
    setBusy(document.id);
    startTransition(async () => {
      const result = await safeAction(setHealthDocumentAlwaysAction)({ id: document.id, always: !document.alwaysInclude });
      setBusy(null);
      setMessage({ text: result.success ? result.message ?? 'Saved.' : result.message, success: result.success });
      if (result.success) router.refresh();
    });
  }

  function download(id: string) {
    setBusy(id);
    startTransition(async () => {
      const result = await safeAction(downloadHealthDocumentAction)(id);
      setBusy(null);
      if (result.success) window.location.href = result.data;
      else setMessage({ text: result.message, success: false });
    });
  }

  function remove(document: HealthDocument) {
    if (!window.confirm(`Delete ${document.fileName}? Its search index is removed too; saved plans stay.`)) return;
    setBusy(document.id);
    startTransition(async () => {
      const result = await safeAction(deleteHealthDocumentAction)(document.id);
      setBusy(null);
      setMessage({ text: result.success ? result.message ?? 'Deleted.' : result.message, success: result.success });
      if (result.success) router.refresh();
    });
  }

  if (state === 'setup') return <p className="fd-msg bad">Apply the health documents migration in Supabase to save documents.</p>;
  if (state === 'unavailable') return <p className="fd-msg bad">Your documents could not be loaded. Refresh and try again.</p>;

  const pinned = documents.filter((document) => document.alwaysInclude).length;

  return (
    <>
      {documents.length > 0 && (
        <FieldHero
          value={String(documents.length)}
          label={documents.length === 1 ? 'file Orbis can read' : 'files Orbis can read'}
          delta={pinned ? { text: `${pinned} pinned`, tone: 'flat' } : null}
        />
      )}

      <label className={`hl-drop ${busy === 'upload' ? 'busy' : ''}`} htmlFor={inputId}>
        {busy === 'upload' ? <LoaderCircle className="workbook-spinner" size={18} aria-hidden="true" /> : <Upload size={18} aria-hidden="true" />}
        <strong>{busy === 'upload' ? 'Reading and indexing…' : 'Add a document'}</strong>
        <span>PDF or .xlsx · up to 100 MB</span>
      </label>
      <input id={inputId} type="file" className="sr-only" accept=".xlsx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={isPending} onChange={(event) => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = '';
        if (file) upload(file);
      }} />
      {message && <p className={`fd-msg ${message.success ? 'ok' : 'bad'}`} role="status">{message.text}</p>}

      {documents.length > 0 ? (
        <>
          <FieldLabel>Saved</FieldLabel>
          <ul className="hl-docs">
            {documents.map((document) => (
              <li key={document.id}>
                <span className={`hl-doc-tile ${document.kind}`} aria-hidden="true">{document.kind === 'pdf' ? <FileText size={16} strokeWidth={1.8} /> : <FileSpreadsheet size={16} strokeWidth={1.8} />}</span>
                <div>
                  <strong>{document.fileName}</strong>
                  {document.alwaysInclude ? <small className="on">Read in every plan</small> : <small>{documentAdded(document.createdAt)} · {documentSize(document.sizeBytes)}</small>}
                </div>
                <button
                  type="button"
                  className="fd-round hl-pin"
                  onClick={() => toggleAlways(document)}
                  disabled={isPending}
                  aria-pressed={document.alwaysInclude}
                  aria-label={`Read ${document.fileName} in every plan`}
                  title={document.alwaysInclude ? 'Read in every plan' : 'Read this in every plan'}
                >
                  <Pin size={14} aria-hidden="true" fill={document.alwaysInclude ? 'currentColor' : 'none'} />
                </button>
                {document.hasOriginal && <button type="button" className="fd-round" onClick={() => download(document.id)} disabled={isPending} aria-label={`Download ${document.fileName}`}>{busy === document.id ? <LoaderCircle className="workbook-spinner" size={14} aria-hidden="true" /> : <Download size={14} aria-hidden="true" />}</button>}
                <button type="button" className="fd-round hl-danger" onClick={() => remove(document)} disabled={isPending} aria-label={`Delete ${document.fileName}`}><Trash2 size={14} aria-hidden="true" /></button>
              </li>
            ))}
          </ul>
          <p className="fd-note">Pinned documents are read into every plan. The rest are searched when they look relevant, and deleting one removes its search index — saved plans stay.</p>
        </>
      ) : <p className="fd-note">Saved documents stay private to your account. Orbis searches them when building a plan — pin one and it is read every time.</p>}
    </>
  );
}
