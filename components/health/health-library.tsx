'use client';

import { useId, useState, useTransition } from 'react';
import { Download, FileSpreadsheet, FileText, LoaderCircle, Pin, Trash2, Upload } from 'lucide-react';
import { deleteHealthDocumentAction, downloadHealthDocumentAction, setHealthDocumentAlwaysAction, signHealthDocumentUploadAction, uploadHealthDocumentAction } from '@/app/health/library-actions';
import type { HealthDocument } from '@/lib/health-docs/types';
import { FieldHero, FieldLabel } from '@/components/field/field';
import { safeAction } from '@/lib/client/safe-action';
import { documentAdded, documentSize } from '@/lib/health-docs/format';
import { UPLOAD_BUCKET, uploadProblem } from '@/lib/storage/upload-rules';
import { createClient } from '@/lib/supabase/client';

/** The body of the Documents view: how many there are, the upload box, and each saved file. */
export function HealthLibrary({ documents, state }: { documents: HealthDocument[]; state: 'ready' | 'setup' | 'unavailable' }) {
  const inputId = useId();
  const [message, setMessage] = useState<{ text: string; success: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // The file goes straight to Storage; the server then reads it from there and indexes it.
  function upload(file: File) {
    setMessage(null);
    const problem = uploadProblem(file);
    if (problem) {
      setMessage({ text: problem, success: false });
      return;
    }
    setBusy('upload');
    startTransition(async () => {
      const finish = (text: string, success: boolean) => {
        setMessage({ text, success });
        setBusy(null);
      };
      const signed = await safeAction(signHealthDocumentUploadAction)({ name: file.name, type: file.type, size: file.size });
      if (!signed.success) return finish(signed.message, false);
      try {
        const { error } = await createClient().storage.from(UPLOAD_BUCKET).uploadToSignedUrl(signed.data.path, signed.data.token, file, { contentType: signed.data.contentType });
        if (error) return finish('The upload did not finish. Check your connection and try again.', false);
      } catch {
        return finish('The upload did not finish. Check your connection and try again.', false);
      }
      const result = await safeAction(uploadHealthDocumentAction)({ path: signed.data.path, name: file.name });
      finish(result.success ? result.message ?? 'Saved.' : result.message, result.success);
    });
  }

  function toggleAlways(document: HealthDocument) {
    setBusy(document.id);
    startTransition(async () => {
      const result = await safeAction(setHealthDocumentAlwaysAction)({ id: document.id, always: !document.alwaysInclude });
      setBusy(null);
      setMessage({ text: result.success ? result.message ?? 'Saved.' : result.message, success: result.success });
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
    });
  }

  if (state === 'setup') return <p className="fd-msg bad">Saving documents isn’t available right now. Try again later.</p>;
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
