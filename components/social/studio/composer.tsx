'use client';

import { useEffect, useId, useRef, useState, useTransition, type ReactNode } from 'react';
import { CalendarDays, ImagePlus, Plus, X } from 'lucide-react';
import { savePostAction } from '@/app/social/actions';
import { uploadPostMedia } from '@/components/social/upload-media';
import { dayLabel } from '@/components/social/social-list';
import { usePersonLocale } from '@/components/locale/person-locale';
import { safeAction } from '@/lib/client/safe-action';
import { titleFromCaption } from '@/lib/social/studio';
import { SOCIAL_FORMATS, SOCIAL_PLATFORMS, type SocialAccount, type SocialFormat, type SocialPlatform, type SocialPost } from '@/lib/social/types';

const ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm';

/**
 * The Studio's write-and-attach box: a caption, a picture or video, the
 * format, a day and where it goes, then Add. Nothing here is written by AI;
 * `extra` holds the Orbis account's Suggest row.
 */
export function Composer({ account, period, onAdded, extra }: Readonly<{
  account: SocialAccount;
  /** The month on screen: an undated post is filed under it. */
  period: string;
  onAdded: (post: SocialPost, message: string) => void;
  extra?: ReactNode;
}>) {
  const id = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const dayInput = useRef<HTMLInputElement>(null);
  const { locale } = usePersonLocale();
  const [caption, setCaption] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [format, setFormat] = useState<SocialFormat>('post');
  const [day, setDay] = useState('');
  const [platforms, setPlatforms] = useState<SocialPlatform[]>(['instagram']);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [isSaving, startSaving] = useTransition();

  // The thumbnail's object URL lives exactly as long as the chosen file.
  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPreview(url);
    return () => { URL.revokeObjectURL(url); setPreview(null); };
  }, [file]);

  const fileType = file ? (file.type.startsWith('video/') ? 'video' : 'image') : null;
  const canAdd = !isSaving && (caption.trim().length > 0 || file !== null);

  function clearFile() {
    setFile(null);
    if (fileInput.current) fileInput.current.value = '';
  }

  function add() {
    if (!canAdd) return;
    setMessage(null);
    startSaving(async () => {
      const saved = await safeAction(savePostAction)({
        clientId: crypto.randomUUID(),
        period: day ? `${day.slice(0, 8)}01` : period,
        title: titleFromCaption(caption, fileType),
        caption: caption.trim(),
        hashtags: [],
        format,
        platforms,
        plannedFor: day || null,
        account,
      });
      if (!saved.success || !saved.post) {
        setMessage({ text: saved.message, error: true });
        return;
      }
      let post = saved.post;
      let note = saved.message;
      if (file) {
        const uploaded = await uploadPostMedia(post.id, file);
        if (uploaded.success) post = uploaded.post;
        else note = `Post added, but the picture didn’t upload: ${uploaded.message}`;
      }
      onAdded(post, note);
      setMessage({ text: note, error: note !== saved.message });
      setCaption('');
      clearFile();
      setDay('');
    });
  }

  const togglePlatform = (platform: SocialPlatform) => setPlatforms((current) => (current.includes(platform) ? current.filter((item) => item !== platform) : [...current, platform]));

  // The extra row (Orbis's Suggest) sits outside the form, so Enter in it never adds the caption as a post.
  return (
    <div className="st-composer">
    <form className="st-composer-form" onSubmit={(event) => { event.preventDefault(); add(); }} aria-busy={isSaving || undefined}>
      <label htmlFor={`${id}-caption`} className="sr-only">Caption</label>
      <textarea
        id={`${id}-caption`}
        className="st-composer-text"
        rows={3}
        maxLength={5000}
        placeholder={account === 'orbis' ? 'Write a post for Orbis…' : 'Write a post…'}
        value={caption}
        onChange={(event) => setCaption(event.currentTarget.value)}
      />

      {file && (
        <div className="st-composer-file">
          {preview && (fileType === 'video'
            ? <video src={preview} muted playsInline preload="metadata" aria-hidden="true" />
            // eslint-disable-next-line @next/next/no-img-element
            : <img src={preview} alt="" />)}
          <span>{file.name}</span>
          <button type="button" className="st-icon-btn" onClick={clearFile} aria-label="Remove the picture or video"><X size={16} aria-hidden="true" /></button>
        </div>
      )}

      <div className="st-composer-bar">
        <input ref={fileInput} id={`${id}-file`} type="file" accept={ACCEPT} className="sr-only" onChange={(event) => setFile(event.currentTarget.files?.[0] ?? null)} />
        <label htmlFor={`${id}-file`} className="st-pill" title="Add a picture or video"><ImagePlus size={16} aria-hidden="true" /><span>Photo</span></label>

        <label className="st-pill st-pill-select">
          <span className="sr-only">Format</span>
          <select value={format} onChange={(event) => setFormat(event.currentTarget.value as SocialFormat)}>
            {SOCIAL_FORMATS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>

        {/* The native picker opens from one plain button; the field itself stays for keyboards and screen readers. */}
        <span className="st-pill st-pill-date">
          <button type="button" className="st-pill-hit" onClick={() => { try { dayInput.current?.showPicker(); } catch { dayInput.current?.focus(); } }}>
            <CalendarDays size={16} aria-hidden="true" />{day ? dayLabel(day, locale) : 'No day'}
          </button>
          <input ref={dayInput} type="date" className="st-date-field" value={day} onChange={(event) => setDay(event.currentTarget.value)} aria-label="Day" tabIndex={-1} />
          {day && <button type="button" className="st-icon-btn st-pill-clear" onClick={() => setDay('')} aria-label="Clear the day"><X size={14} aria-hidden="true" /></button>}
        </span>

        <details className="st-pill-menu">
          <summary className="st-pill">{platforms.length ? SOCIAL_PLATFORMS.filter((item) => platforms.includes(item.id)).map((item) => item.label).join(', ') : 'Where'}</summary>
          <fieldset>
            <legend className="sr-only">Where it goes</legend>
            {SOCIAL_PLATFORMS.map((item) => (
              <label key={item.id}><input type="checkbox" checked={platforms.includes(item.id)} onChange={() => togglePlatform(item.id)} />{item.label}</label>
            ))}
          </fieldset>
        </details>

        <button type="submit" className="st-add" disabled={!canAdd}><Plus size={17} aria-hidden="true" />{isSaving ? 'Adding…' : 'Add'}</button>
      </div>

      {message && <output className={`st-composer-msg${message.error ? ' error' : ''}`}>{message.text}</output>}
    </form>
    {extra}
    </div>
  );
}
