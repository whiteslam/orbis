'use client';

import { useId, useState } from 'react';
import { FileText, LoaderCircle, Upload } from 'lucide-react';
import { createResumeUploadAction, processResumeAction } from '@/app/career/actions';
import { NoticeLine } from '@/components/career/bits';
import type { Notice } from '@/components/career/use-run';
import { connectionMessage } from '@/lib/client/safe-action';
import { createClient } from '@/lib/supabase/client';
import type { CareerProfile } from '@/lib/career/types';

const BUCKET = 'career-documents';
const MAX_BYTES = 10 * 1024 * 1024;
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

type Phase = 'idle' | 'uploading' | 'reading';

const PHASE_TEXT: Record<Exclude<Phase, 'idle'>, string> = {
  uploading: 'Uploading your resume…',
  reading: 'Reading it into your profile. This takes up to a minute…',
};

/** Why this file can't be used, or null. Checked here so a wrong file never starts an upload. */
function fileProblem(file: File): string | null {
  const name = file.name.toLowerCase();
  const pdf = name.endsWith('.pdf') || file.type === 'application/pdf';
  const docx = name.endsWith('.docx') || file.type === DOCX;
  if (!pdf && !docx) return 'Choose a PDF or a Word (.docx) file.';
  if (file.size > MAX_BYTES) return 'This file is over 10 MB. Save a smaller copy and try again.';
  if (file.size === 0) return 'This file is empty. Choose it again.';
  return null;
}

function contentType(file: File) {
  if (file.type) return file.type;
  return file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : DOCX;
}

/** Calls an action, turning a dropped connection into a failure result. */
async function attempt<T>(call: () => Promise<{ success: true; data: T } | { success: false; message: string }>) {
  try {
    return await call();
  } catch {
    return { success: false as const, message: connectionMessage() };
  }
}

/**
 * The master resume: a PDF or DOCX up to 10 MB, uploaded straight to Storage
 * on a one-time signed URL, then read by the server into the profile.
 * Re-uploading merges; facts the owner edited are never dropped.
 */
export function SetupResume({ fileName, onProfile }: Readonly<{ fileName: string | null; onProfile: (profile: CareerProfile, fileName: string) => void }>) {
  const inputId = useId();
  const [phase, setPhase] = useState<Phase>('idle');
  const [notice, setNotice] = useState<Notice | null>(null);

  async function upload(file: File) {
    const problem = fileProblem(file);
    if (problem) {
      setNotice({ text: problem, ok: false });
      return;
    }
    setNotice(null);
    setPhase('uploading');
    const fail = (text: string) => {
      setPhase('idle');
      setNotice({ text, ok: false });
    };
    const signed = await attempt(() => createResumeUploadAction({ name: file.name, type: contentType(file), size: file.size }));
    if (!signed.success) return fail(signed.message);
    try {
      const { error } = await createClient().storage.from(BUCKET).uploadToSignedUrl(signed.data.path, signed.data.token, file, { contentType: contentType(file) });
      if (error) return fail('The upload did not finish. Check your connection and try again.');
    } catch {
      return fail('The upload did not finish. Check your connection and try again.');
    }
    setPhase('reading');
    const parsed = await attempt(() => processResumeAction(signed.data.path, file.name));
    if (!parsed.success) return fail(parsed.message);
    setPhase('idle');
    onProfile(parsed.data, file.name);
    setNotice({ text: `Read ${parsed.data.roles.length} roles, ${parsed.data.facts.length} facts and ${parsed.data.skills.length} skills. Check them below.`, ok: true });
  }

  const busy = phase !== 'idle';
  return (
    <>
      {fileName && (
        <p className="cr-onfile"><FileText size={15} aria-hidden="true" /><span><b>{fileName}</b><small>Your master resume, kept on file</small></span></p>
      )}
      <label className={`hl-drop cr-drop${busy ? ' busy' : ''}`} htmlFor={inputId}>
        {busy ? <LoaderCircle className="cr-spin" size={18} aria-hidden="true" /> : <Upload size={18} aria-hidden="true" />}
        <strong>{fileName ? 'Upload a newer resume' : 'Upload your resume'}</strong>
        <span>PDF or DOCX, up to 10 MB</span>
      </label>
      <input id={inputId} type="file" className="sr-only" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" disabled={busy} onChange={(event) => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = '';
        if (file) void upload(file);
      }} />
      {busy && (
        <div className="cr-progress">
          <div className="cr-progress-bar indeterminate" aria-hidden="true"><i /></div>
          <output>{PHASE_TEXT[phase]}</output>
        </div>
      )}
      <NoticeLine notice={notice} />
      {fileName && <p className="fd-hint cr-gap-top">A new upload merges into your profile. Facts you’ve edited or confirmed are always kept.</p>}
    </>
  );
}
