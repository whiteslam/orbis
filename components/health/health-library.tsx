'use client';

import { useId, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Download, FileSpreadsheet, FileText, LoaderCircle, Trash2, Upload } from 'lucide-react';
import { deleteHealthDocumentAction, downloadHealthDocumentAction, uploadHealthDocumentAction } from '@/app/health/library-actions';
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
        {busy === 'upload' ? <LoaderCircle className="workbook-spinner" size={20} /> : <Upload size={20} />}
        <strong>{busy === 'upload' ? 'Reading and indexing…' : 'Add a health document'}</strong>
        <span>Lab reports, fitness logs, diet sheets · PDF or .xlsx</span>
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
                <small>{added(document.createdAt)} · {size(document.sizeBytes)} · {document.chunkCount} sections indexed</small>
              </div>
              {document.hasOriginal && <button type="button" className="workbook-icon-button" onClick={() => download(document.id)} disabled={isPending} aria-label={`Download ${document.fileName}`}>{busy === document.id ? <LoaderCircle className="workbook-spinner" size={14} /> : <Download size={14} />}</button>}
              <button type="button" className="workbook-icon-button" onClick={() => remove(document)} disabled={isPending} aria-label={`Delete ${document.fileName}`}><Trash2 size={14} /></button>
            </li>
          ))}
        </ul>
      ) : <p className="groww-muted">Saved documents appear here. Orbis searches them when building your plan.</p>}
      <p className="groww-muted">Files are private to your account. Uploading sends the document’s text to OpenRouter once to index it for search; relevant passages are sent again when you build a plan.</p>
    </section>
  );
}
