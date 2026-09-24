'use client';

import { useId, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Download, FileSpreadsheet, FileText, LoaderCircle, Pin, Trash2, Upload } from 'lucide-react';
import { deleteHealthDocumentAction, downloadHealthDocumentAction, setHealthDocumentAlwaysAction, uploadHealthDocumentAction } from '@/app/health/library-actions';
import type { HealthDocument } from '@/lib/health-docs/types';
import { safeAction } from '@/lib/client/safe-action';

function size(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function added(value: string) {
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(new Date(value));
}

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

  if (state === 'setup') return <p className="finance-notice error">Apply the health documents migration in Supabase to save documents.</p>;
  if (state === 'unavailable') return <p className="finance-notice error">Your documents could not be loaded. Refresh and try again.</p>;

  return (
    <section className="health-library">
      <label className={`health-drop ${busy === 'upload' ? 'busy' : ''}`} htmlFor={inputId}>
        {busy === 'upload' ? <LoaderCircle className="workbook-spinner" size={16} /> : <Upload size={16} />}
        <strong>{busy === 'upload' ? 'Reading and indexing…' : 'Add a document'}</strong>
        <span>PDF or .xlsx</span>
      </label>
      <input id={inputId} type="file" className="sr-only" accept=".xlsx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={isPending} onChange={(event) => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = '';
        if (file) upload(file);
      }} />
      {message && <p className={`finance-notice ${message.success ? 'success' : 'error'}`} role="status">{message.text}</p>}

      {documents.length > 0 ? (
        <ul className="health-docs">
          {documents.map((document) => (
            <li key={document.id}>
              <span className={`health-doc-icon ${document.kind}`}>{document.kind === 'pdf' ? <FileText size={16} /> : <FileSpreadsheet size={16} />}</span>
              <div>
                <strong>{document.fileName}</strong>
                <small>{document.alwaysInclude ? 'Read in every plan' : `${added(document.createdAt)} · ${size(document.sizeBytes)}`}</small>
              </div>
              <button
                type="button"
                className={`health-doc-pin ${document.alwaysInclude ? 'on' : ''}`}
                onClick={() => toggleAlways(document)}
                disabled={isPending}
                aria-pressed={document.alwaysInclude}
                title={document.alwaysInclude ? 'Read in every plan' : 'Read this in every plan'}
              >
                <Pin size={13} />
              </button>
              {document.hasOriginal && <button type="button" className="workbook-icon-button" onClick={() => download(document.id)} disabled={isPending} aria-label={`Download ${document.fileName}`}>{busy === document.id ? <LoaderCircle className="workbook-spinner" size={14} /> : <Download size={14} />}</button>}
              <button type="button" className="workbook-icon-button" onClick={() => remove(document)} disabled={isPending} aria-label={`Delete ${document.fileName}`}><Trash2 size={14} /></button>
            </li>
          ))}
        </ul>
      ) : <p className="fd-note">Saved documents stay private to your account. Orbis searches them when building a plan — pin one and it is read every time.</p>}
      {documents.length > 0 && <p className="fd-note">Pinned documents are read into every plan; the rest are searched when relevant.</p>}
    </section>
  );
}
