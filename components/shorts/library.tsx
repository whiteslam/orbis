'use client';

import { useEffect, useState } from 'react';
import { Check, Copy, Download, LoaderCircle, Play, Trash2 } from 'lucide-react';
import { deleteShortAction, loadFilesAction } from '@/app/shorts/actions';
import { safeAction } from '@/lib/client/safe-action';
import type { ShortJob } from '@/lib/shorts/types';
import type { ShortFiles } from '@/lib/shorts/view';

function CopyButton({ text, label }: Readonly<{ text: string; label: string }>) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }
  return (
    <button type="button" className="sh-copy" onClick={() => void copy()} aria-label={`Copy the ${label}`}>
      {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
      <span>{copied ? 'Copied' : 'Copy'}</span>
    </button>
  );
}

/** Finished shorts as 9:16 tiles, newest first. */
export function LibraryGrid({ jobs, covers, onOpen }: Readonly<{ jobs: ShortJob[]; covers: Record<string, string>; onOpen: (id: string) => void }>) {
  if (!jobs.length) return <p className="sh-empty">Finished shorts land here, ready to download and post.</p>;
  return (
    <ul className="sh-library" aria-label="Finished shorts">
      {jobs.map((job) => (
        <li key={job.id}>
          <button type="button" className="sh-tile" onClick={() => onOpen(job.id)}>
            {covers[job.id]
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={covers[job.id]} alt="" loading="lazy" decoding="async" />
              : <span className="sh-tile-blank" aria-hidden="true"><Play size={22} /></span>}
            <span className="sh-tile-title">{job.delivery?.title ?? job.plan?.title ?? job.topic}</span>
            {job.delivery && <span className="sh-tile-len">{Math.round(job.delivery.seconds)} s</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** A finished short: watch it, download it, and the words to post it with. */
export function ShortResult({ job, onDeleted }: Readonly<{ job: ShortJob; onDeleted: () => void }>) {
  const [files, setFiles] = useState<ShortFiles | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const delivery = job.delivery;

  useEffect(() => {
    let live = true;
    void safeAction(loadFilesAction)(job.id).then((result) => {
      if (!live) return;
      if (result.success) setFiles(result.data);
      else setProblem(result.message);
    });
    return () => { live = false; };
  }, [job.id]);

  async function remove() {
    setDeleting(true);
    const result = await safeAction(deleteShortAction)(job.id);
    setDeleting(false);
    if (!result.success) return setProblem(result.message);
    onDeleted();
  }

  if (!delivery) return <p className="fd-msg bad">This short finished without its files. Delete it and make it again.</p>;
  const name = `${delivery.title.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'short'}.mp4`;
  const post = [delivery.caption, delivery.hashtags.join(' ')].filter(Boolean).join('\n\n');

  return (
    <section className="sh-result" aria-label="Your short">
      <div className="sh-player">
        {files ? (
          <video src={files.video} poster={files.cover ?? undefined} controls playsInline preload="metadata" aria-label={delivery.title} />
        ) : (
          <div className="sh-player-wait">{problem ? null : <LoaderCircle className="workbook-spinner" size={22} aria-label="Loading the video" />}</div>
        )}
      </div>
      <div className="sh-result-side">
        {problem && <p className="fd-msg bad">{problem}</p>}
        <div className="sh-actions">
          {files && (
            <a className="so-action primary" href={files.video} download={name}>
              <Download size={16} aria-hidden="true" /><span>Download MP4</span>
            </a>
          )}
          {files?.share && (
            <a className="so-action" href={files.share} download={name.replace('.mp4', '-share.mp4')}>
              <Download size={15} aria-hidden="true" /><span>Smaller copy</span>
            </a>
          )}
          {files?.cover && (
            <a className="fd-link" href={files.cover} download={name.replace('.mp4', '-cover.jpg')}>Cover image</a>
          )}
        </div>

        <dl className="sh-post">
          <div><dt>Title <CopyButton text={delivery.title} label="title" /></dt><dd>{delivery.title}</dd></div>
          {post && <div><dt>Caption and hashtags <CopyButton text={post} label="caption and hashtags" /></dt><dd className="sh-post-text">{post}</dd></div>}
          <div><dt>Length</dt><dd>{delivery.seconds.toFixed(1)} s, 1080×1920</dd></div>
        </dl>

        {delivery.qa.length > 0 && (
          <details className="sh-qa">
            <summary>What QA caught ({delivery.qa.length})</summary>
            <ul>{delivery.qa.map((item) => <li key={item}>{item.replace(/^QA:\s*/i, '')}</li>)}</ul>
          </details>
        )}
        {files?.sheet && (
          <details className="sh-qa">
            <summary>Contact sheet</summary>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="sh-contact" src={files.sheet} alt="Every half second of the short, as checked by QA" loading="lazy" />
          </details>
        )}

        <div className="sh-delete">
          {confirming ? (
            <>
              <span>Delete this short and its files?</span>
              <button type="button" className="fd-link alert" onClick={() => void remove()} disabled={deleting}>{deleting ? 'Deleting…' : 'Delete'}</button>
              <button type="button" className="fd-link" onClick={() => setConfirming(false)}>Keep</button>
            </>
          ) : (
            <button type="button" className="fd-link alert" onClick={() => setConfirming(true)}><Trash2 size={13} aria-hidden="true" /> Delete</button>
          )}
        </div>
      </div>
    </section>
  );
}
