'use client';

import { useId, useState, useTransition } from 'react';
import { Sparkles, Trash2, Upload } from 'lucide-react';
import { FieldLabel, FieldSubHead } from '@/components/field/field';
import { StatusChip } from '@/components/social/status-chip';
import { dayLabel } from '@/components/social/social-list';
import {
  attachMediaAction,
  deletePostAction,
  duplicatePostAction,
  loadPostHistoryAction,
  markPublishedAction,
  movePostAction,
  removeMediaAction,
  savePostAction,
  setPostStatusAction,
  signMediaUploadAction,
} from '@/app/social/actions';
import { daysInMonth, monthName, postedLength, readyProblem } from '@/lib/social/month';
import {
  CAPTION_LIMIT,
  PUBLISH_PLACES,
  SOCIAL_CAPS,
  SOCIAL_FORMATS,
  SOCIAL_PLATFORMS,
  formatLabel,
  platformLabel,
  type SocialFormat,
  type SocialPlatform,
  type SocialPost,
  type SocialRevision,
} from '@/lib/social/types';
import { createClient } from '@/lib/supabase/client';
import { safeAction } from '@/lib/client/safe-action';

type Form = {
  title: string;
  headline: string;
  caption: string;
  hashtags: string;
  format: SocialFormat;
  platforms: SocialPlatform[];
  plannedFor: string;
};

const formOf = (post: SocialPost | null, date: string | null): Form => ({
  title: post?.title ?? '',
  headline: post?.headline ?? '',
  caption: post?.caption ?? '',
  hashtags: post?.hashtags.map((tag) => `#${tag}`).join(' ') ?? '',
  format: post?.format ?? 'post',
  platforms: post?.platforms ?? ['instagram'],
  plannedFor: post?.plannedFor ?? date ?? '',
});

const tagsOf = (text: string) => text.split(/[\s,]+/).map((tag) => tag.replace(/^#+/, '')).filter(Boolean);

const ACTION_LABEL: Record<string, string> = {
  created: 'Created', edited: 'Edited', ai_draft: 'Drafted by AI', ready: 'Marked ready', unready: 'Back to draft',
  published: 'Marked published', unpublished: 'Marked not published', moved: 'Moved to another month', deleted: 'Deleted',
};
const FIELD_LABEL: Record<string, string> = {
  title: 'Title', headline: 'Headline', caption: 'Caption', hashtags: 'Hashtags', format: 'Format', platforms: 'Platforms',
  period: 'Month', plannedFor: 'Day', status: 'Status', mediaPath: 'Picture or video', published: 'Published',
};

function show(value: unknown) {
  if (value === null || value === undefined || value === '') return '—';
  if (Array.isArray(value)) return value.length ? value.join(', ') : '—';
  if (typeof value === 'object') return JSON.stringify(value);
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  return '—';
}

/** A media path is a storage key, so the history says whether there was a file, not where. */
function shownBefore(key: string, value: unknown) {
  if (key === 'mediaPath') return value ? 'A file' : '—';
  return show(value);
}

function shownAfter(key: string, value: unknown) {
  if (key === 'mediaPath') return value ? 'A new file' : 'Removed';
  return show(value);
}

const busyLabel = (busy: string | null, key: string, idle: string, working: string) => (busy === key ? working : idle);

type Publishing = { platform: string; link: string };

function HistoryList({ history }: Readonly<{ history: SocialRevision[] }>) {
  if (!history.length) return <p className="fd-empty">No history yet.</p>;
  return (
    <ul>
      {history.map((entry) => {
        const changed = entry.previous && entry.snapshot
          ? Object.keys(entry.snapshot).filter((key) => JSON.stringify(entry.previous?.[key]) !== JSON.stringify(entry.snapshot?.[key]))
          : [];
        return (
          <li key={entry.id}>
            <strong>{ACTION_LABEL[entry.action] ?? entry.action}</strong>
            <time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' })}</time>
            {changed.length > 0 && (
              <details className="so-diff">
                <summary>{changed.map((key) => FIELD_LABEL[key] ?? key).join(', ')}</summary>
                <dl>
                  {changed.map((key) => (
                    <div key={key}>
                      <dt>{FIELD_LABEL[key] ?? key}</dt>
                      <dd>
                        <del>{shownBefore(key, entry.previous?.[key])}</del>
                        {' → '}
                        <ins>{shownAfter(key, entry.snapshot?.[key])}</ins>
                      </dd>
                    </div>
                  ))}
                </dl>
              </details>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function HistoryPanel({ history, loading }: Readonly<{ history: SocialRevision[] | null; loading: boolean }>) {
  if (history) return <HistoryList history={history} />;
  return <p className="fd-empty">{loading ? 'Loading…' : 'History could not be loaded.'}</p>;
}

/** Status, AI mark, format and day, under the post's title. */
function DrawerLead({ saved }: Readonly<{ saved: SocialPost }>) {
  const day = saved.plannedFor ? ` · ${dayLabel(saved.plannedFor)}` : ' · no date yet';
  return (
    <span className="so-tags">
      <StatusChip status={saved.status} />
      {saved.source === 'ai' && <span className="so-ai"><Sparkles size={9} aria-hidden="true" />AI draft</span>}
      <span>{formatLabel(saved.format)}{day}</span>
    </span>
  );
}

function PublishedNote({ published }: Readonly<{ published: NonNullable<SocialPost['published']> }>) {
  return (
    <p className="so-published-note">
      Published on {platformLabel(published.platform)}, {new Date(published.at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' })}.
      {published.link && <> <a href={published.link} target="_blank" rel="noopener noreferrer">Open the post</a></>}
      {' '}Mark it as not published to change it.
    </p>
  );
}

/** Characters used against each chosen platform's caption limit. */
function CaptionCounter({ platforms, length }: Readonly<{ platforms: SocialPlatform[]; length: number }>) {
  const used = length.toLocaleString('en-IN');
  return (
    <p className="so-counter" aria-live="polite">
      {platforms.length
        ? platforms.map((platform) => {
          const over = length > CAPTION_LIMIT[platform];
          return (
            <span key={platform} className={over ? 'over' : undefined}>
              {platformLabel(platform)} {used} / {CAPTION_LIMIT[platform].toLocaleString('en-IN')}{over ? ', too long' : ''}
            </span>
          );
        })
        : <span>{used} characters, hashtags included</span>}
    </p>
  );
}

function MediaPreview({ saved, format }: Readonly<{ saved: SocialPost | null; format: SocialFormat }>) {
  const emptyNote = format === 'post' ? 'Optional for a post.' : `A ${format} needs one before it can be marked ready.`;
  return (
    <div className="so-media-frame">
      {saved?.mediaUrl && saved.mediaType === 'image' && <img src={saved.mediaUrl} alt={saved.title} />}
      {saved?.mediaUrl && saved.mediaType === 'video' && (
        <video src={saved.mediaUrl} controls playsInline preload="metadata">
          <track kind="captions" />
        </video>
      )}
      {!saved?.mediaPath && <p className="so-media-empty">{emptyNote}</p>}
      {saved?.mediaPath && !saved.mediaUrl && <p className="so-media-empty">The file is saved but could not be shown right now.</p>}
    </div>
  );
}

function MediaUpload({ hasMedia, busy, onUpload, onRemove }: Readonly<{
  hasMedia: boolean;
  busy: string | null;
  onUpload: (file: File) => void;
  onRemove: () => void;
}>) {
  const fileId = useId();
  return (
    <div className="fd-act">
      <label htmlFor={fileId} className="fd-button ghost" aria-disabled={busy === 'media'}>
        <Upload size={14} aria-hidden="true" />{busyLabel(busy, 'media', hasMedia ? 'Replace' : 'Upload', 'Uploading…')}
      </label>
      <input
        id={fileId}
        type="file"
        className="sr-only"
        accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm"
        disabled={busy === 'media'}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file) onUpload(file);
        }}
      />
      {hasMedia && <button type="button" className="fd-link" disabled={busy === 'media-remove'} onClick={onRemove}>{busyLabel(busy, 'media-remove', 'Remove', 'Removing…')}</button>}
    </div>
  );
}

function PublishForm({ publishing, busy, onChange, onPublish, onCancel }: Readonly<{
  publishing: Publishing;
  busy: string | null;
  onChange: (next: Publishing) => void;
  onPublish: () => void;
  onCancel: () => void;
}>) {
  return (
    <div className="so-publish">
      <label className="fd-field">Where did it go out?{' '}
        <select value={publishing.platform} onChange={(event) => onChange({ ...publishing, platform: event.currentTarget.value })}>
          {PUBLISH_PLACES.map((place) => <option key={place.id} value={place.id}>{place.label}</option>)}
        </select>
      </label>
      <label className="fd-field wide">Link (optional){' '}
        <input type="url" inputMode="url" placeholder="https://" value={publishing.link} onChange={(event) => onChange({ ...publishing, link: event.currentTarget.value })} />
      </label>
      <div className="fd-act">
        <button type="button" disabled={busy === 'publish'} onClick={onPublish}>{busyLabel(busy, 'publish', 'Mark published', 'Saving…')}</button>
        <button type="button" className="fd-link" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

/** The buttons that move a post along: save, ready, published, and back again. */
function ActionBar({ saved, locked, dirty, busy, publishing, onReady, onStartPublish, onDraft, onUnpublish }: Readonly<{
  saved: SocialPost | null;
  locked: boolean;
  dirty: boolean;
  busy: string | null;
  publishing: boolean;
  onReady: () => void;
  onStartPublish: (post: SocialPost) => void;
  onDraft: () => void;
  onUnpublish: () => void;
}>) {
  const canMarkReady = !saved || saved.status === 'idea' || saved.status === 'draft';
  const isReady = saved?.status === 'ready';
  return (
    <div className="so-bar">
      <div className="fd-act">
        {!locked && <button type="submit" disabled={busy === 'save' || (!dirty && Boolean(saved))}>{busyLabel(busy, 'save', saved ? 'Save' : 'Add post', 'Saving…')}</button>}
        {canMarkReady && (
          <button type="button" className="ghost" disabled={busy === 'ready'} onClick={onReady}>{busyLabel(busy, 'ready', 'Mark ready', 'Checking…')}</button>
        )}
        {isReady && !publishing && (
          <button type="button" className="ghost" onClick={() => onStartPublish(saved)}>Mark published</button>
        )}
        {isReady && (
          <button type="button" className="fd-link" disabled={busy === 'draft'} onClick={onDraft}>{busyLabel(busy, 'draft', 'Back to draft', 'Saving…')}</button>
        )}
        {locked && <button type="button" className="ghost" disabled={busy === 'unpublish'} onClick={onUnpublish}>{busyLabel(busy, 'unpublish', 'Mark as not published', 'Saving…')}</button>}
      </div>
    </div>
  );
}

function MoreMenu({ locked, busy, moveTo, onMoveTo, onDuplicate, onMove, onRemove }: Readonly<{
  locked: boolean;
  busy: string | null;
  moveTo: string;
  onMoveTo: (month: string) => void;
  onDuplicate: () => void;
  onMove: () => void;
  onRemove: () => void;
}>) {
  return (
    <details className="so-more-menu">
      <summary>More: copy, move or delete</summary>
      <div className="fd-act">
        <button type="button" className="ghost" disabled={busy === 'duplicate'} onClick={onDuplicate}>{busyLabel(busy, 'duplicate', 'Duplicate', 'Copying…')}</button>
        {!locked && (
          <>
            <label className="fd-field">Move to{' '}
              <input type="month" value={moveTo} onChange={(event) => onMoveTo(event.currentTarget.value)} />
            </label>
            <button type="button" className="ghost" disabled={!moveTo || busy === 'move'} onClick={onMove}>{busyLabel(busy, 'move', 'Move', 'Moving…')}</button>
          </>
        )}
        <button type="button" className="fd-link alert" disabled={busy === 'delete'} onClick={onRemove}><Trash2 size={13} aria-hidden="true" />{busyLabel(busy, 'delete', 'Delete', 'Deleting…')}</button>
      </div>
    </details>
  );
}

/**
 * One post, full screen: write it, attach its picture or video, mark it ready,
 * record where it went out, and read what changed.
 *
 * Each write disables only the button that was pressed. The server makes every
 * status change conditional on what it read, so two taps cannot corrupt a post.
 */
export function PostDrawer({ period, post, initialDate, initialFormat = 'post', onClose, onChanged, onRemoved }: Readonly<{
  period: string;
  post: SocialPost | null;
  initialDate: string | null;
  initialFormat?: SocialFormat;
  onClose: () => void;
  /** A post was created or changed (it may now belong to another month). */
  onChanged: (post: SocialPost) => void;
  onRemoved: (id: string) => void;
}>) {
  const [saved, setSaved] = useState<SocialPost | null>(post);
  const [form, setForm] = useState<Form>(() => (post ? formOf(post, null) : { ...formOf(null, initialDate), format: initialFormat }));
  // A new post's id is chosen here, so a second tap on Save finds the first post instead of making another.
  const [clientId] = useState(() => crypto.randomUUID());
  const [tab, setTab] = useState<'edit' | 'history'>('edit');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [publishing, setPublishing] = useState<Publishing | null>(null);
  const [history, setHistory] = useState<SocialRevision[] | null>(null);
  const [moveTo, setMoveTo] = useState('');
  const [, startTransition] = useTransition();

  const locked = saved?.status === 'published';
  const postPeriod = saved?.period ?? period;
  const lastDay = `${postPeriod.slice(0, 8)}${String(daysInMonth(postPeriod)).padStart(2, '0')}`;
  const dirty = !saved || JSON.stringify(formOf(saved, null)) !== JSON.stringify(form);
  const length = postedLength(form.caption, tagsOf(form.hashtags));

  function run(key: string, work: () => Promise<void>) {
    setBusy(key);
    setMessage(null);
    startTransition(async () => {
      try {
        await work();
      } finally {
        setBusy(null);
      }
    });
  }

  function accept(next: SocialPost, text: string) {
    setSaved(next);
    setForm(formOf(next, null));
    setHistory(null);
    onChanged(next);
    setMessage({ text, error: false });
  }

  /** Saves if there is anything to save, and returns the post as the server now has it. */
  async function persist(): Promise<SocialPost | null> {
    if (saved && !dirty) return saved;
    const result = await safeAction(savePostAction)({
      id: saved?.id,
      clientId: saved ? undefined : clientId,
      period: postPeriod,
      title: form.title,
      headline: form.headline,
      caption: form.caption,
      hashtags: tagsOf(form.hashtags),
      format: form.format,
      platforms: form.platforms,
      plannedFor: form.plannedFor || null,
    });
    if (!result.success || !result.post) {
      setMessage({ text: result.message, error: true });
      return null;
    }
    const droppedToDraft = saved?.status === 'ready' && result.post.status === 'draft';
    accept(result.post, droppedToDraft ? 'Saved. It is back to draft. Mark it ready again when you are happy with it.' : result.message);
    return result.post;
  }

  const save = () => run('save', async () => { setProblem(null); await persist(); });

  const markReady = () => run('ready', async () => {
    const current = await persist();
    if (!current) return;
    const missing = readyProblem(current);
    setProblem(missing);
    if (missing) return;
    const result = await safeAction(setPostStatusAction)(current.id, 'ready');
    if (result.success && result.post) accept(result.post, result.message);
    else setProblem(result.message);
  });

  // Every action below saves pending edits first (or refuses), because accept() resets the form to the server's copy.
  const setDraftStatus = (status: 'idea' | 'draft') => run(status, async () => {
    const current = await persist();
    if (!current) return;
    const result = await safeAction(setPostStatusAction)(current.id, status);
    if (result.success && result.post) accept(result.post, result.message);
    else setMessage({ text: result.message, error: true });
  });

  const publish = () => run('publish', async () => {
    if (!saved || !publishing) return;
    if (dirty) {
      // Saving an edit to a ready post sends it back to draft, so publishing the unsaved words is not possible.
      setMessage({ text: 'You have unsaved changes. Save them and mark the post ready again, or undo them, before recording it as published.', error: true });
      return;
    }
    const result = await safeAction(markPublishedAction)(saved.id, { platform: publishing.platform, link: publishing.link || null });
    if (result.success && result.post) {
      setPublishing(null);
      accept(result.post, result.message);
    } else setMessage({ text: result.message, error: true });
  });

  const unpublish = () => run('unpublish', async () => {
    if (!saved) return;
    const result = await safeAction(markPublishedAction)(saved.id, null);
    if (result.success && result.post) accept(result.post, result.message);
    else setMessage({ text: result.message, error: true });
  });

  const duplicate = () => run('duplicate', async () => {
    if (!saved) return;
    const result = await safeAction(duplicatePostAction)(saved.id);
    if (result.success && result.post) {
      onChanged(result.post);
      setMessage({ text: `${result.message} It is in the list as “${result.post.title}”.`, error: false });
    } else setMessage({ text: result.message, error: true });
  });

  const move = () => run('move', async () => {
    if (!saved || !moveTo) return;
    const current = await persist();
    if (!current) return;
    const result = await safeAction(movePostAction)(current.id, `${moveTo}-01`);
    if (result.success && result.post) {
      accept(result.post, `${result.message} It is now in ${monthName(result.post.period)}.`);
      setMoveTo('');
    } else setMessage({ text: result.message, error: true });
  });

  const remove = () => {
    if (!saved || !window.confirm(`Delete “${saved.title}”? Its history is kept.`)) return;
    run('delete', async () => {
      const result = await safeAction(deletePostAction)(saved.id);
      if (result.success) {
        onRemoved(saved.id);
        onClose();
      } else setMessage({ text: result.message, error: true });
    });
  };

  const upload = (file: File) => run('media', async () => {
    const current = await persist();
    if (!current) return;
    const signed = await safeAction(signMediaUploadAction)(current.id, { name: file.name, type: file.type, size: file.size });
    if (!signed.success || !signed.path || !signed.token) {
      setMessage({ text: signed.message, error: true });
      return;
    }
    const { error } = await createClient().storage.from('social-media').uploadToSignedUrl(signed.path, signed.token, file, { contentType: file.type });
    if (error) {
      setMessage({ text: 'The upload did not finish. Check your connection and try again.', error: true });
      return;
    }
    const result = await safeAction(attachMediaAction)(current.id, signed.path, file.type.startsWith('video/') ? 'video' : 'image');
    if (result.success && result.post) accept(result.post, result.message);
    else setMessage({ text: result.message, error: true });
  });

  const removeMedia = () => run('media-remove', async () => {
    const current = await persist();
    if (!current) return;
    const result = await safeAction(removeMediaAction)(current.id);
    if (result.success && result.post) accept(result.post, result.message);
    else setMessage({ text: result.message, error: true });
  });

  const openHistory = () => {
    setTab('history');
    if (!saved || history) return;
    run('history', async () => {
      const result = await safeAction(loadPostHistoryAction)(saved.id);
      if (result.success && result.history) setHistory(result.history);
      else setMessage({ text: result.message, error: true });
    });
  };

  const togglePlatform = (platform: SocialPlatform) => setForm((current) => ({
    ...current,
    platforms: current.platforms.includes(platform) ? current.platforms.filter((item) => item !== platform) : [...current.platforms, platform],
  }));

  return (
    <div className="so-drawer">
      <FieldSubHead
        crumb={`Social · ${monthName(postPeriod)}`}
        title={saved ? saved.title : 'New post'}
        onClose={onClose}
        backLabel="Close post"
        lead={saved && <DrawerLead saved={saved} />}
      />

      {saved && (
        <div className="fd-tabs" role="tablist" aria-label="Post views">
          <button type="button" role="tab" aria-selected={tab === 'edit'} onClick={() => setTab('edit')}>Post</button>
          <button type="button" role="tab" aria-selected={tab === 'history'} onClick={openHistory}>History</button>
        </div>
      )}

      {tab === 'history' && saved ? (
        <section className="so-history">
          <HistoryPanel history={history} loading={busy === 'history'} />
        </section>
      ) : (
        <form className="fd-form" onSubmit={(event) => { event.preventDefault(); save(); }}>
          {locked && saved?.published && <PublishedNote published={saved.published} />}

          {/* The words lead; the format, day, platforms and picture sit beside them on desktop. */}
          <div className="so-edit-main">
            <label className="fd-field wide">Title{' '}
              <input value={form.title} maxLength={SOCIAL_CAPS.title} required disabled={locked} placeholder="What this post is about" onChange={(event) => setForm({ ...form, title: event.currentTarget.value })} />
            </label>
            <label className="fd-field wide">Headline <span>(optional, the words on the image)</span>
              <input value={form.headline} maxLength={SOCIAL_CAPS.headline} disabled={locked} onChange={(event) => setForm({ ...form, headline: event.currentTarget.value })} />
            </label>
            <label className="fd-field wide">Caption{' '}
              <textarea rows={7} value={form.caption} maxLength={SOCIAL_CAPS.caption} disabled={locked} onChange={(event) => setForm({ ...form, caption: event.currentTarget.value })} />
            </label>
            <CaptionCounter platforms={form.platforms} length={length} />
            <label className="fd-field wide">Hashtags{' '}
              <input value={form.hashtags} disabled={locked} placeholder="#autumn #recipes" onChange={(event) => setForm({ ...form, hashtags: event.currentTarget.value })} />
            </label>

          </div>
          <div className="so-edit-side">
            <div className="fd-seg" role="radiogroup" aria-label="Format">
              {SOCIAL_FORMATS.map((format) => (
                <button key={format.id} type="button" role="radio" aria-checked={form.format === format.id} disabled={locked} onClick={() => setForm({ ...form, format: format.id })}>{format.label}</button>
              ))}
            </div>

            <div className="so-row-2">
              <label className="fd-field wide">Day{' '}
                <input type="date" value={form.plannedFor} min={postPeriod} max={lastDay} disabled={locked} onChange={(event) => setForm({ ...form, plannedFor: event.currentTarget.value })} />
              </label>
              {saved && saved.status !== 'ready' && saved.status !== 'published' ? (
                <label className="fd-field wide">Stage{' '}
                  <select value={saved.status} disabled={busy !== null} onChange={(event) => setDraftStatus(event.currentTarget.value as 'idea' | 'draft')}>
                    <option value="idea">Idea</option>
                    <option value="draft">Draft</option>
                  </select>
                </label>
              ) : <span />}
            </div>

            <fieldset className="fd-chips">
              <legend className="fd-label">Platforms</legend>
              <div>
                {SOCIAL_PLATFORMS.map((platform) => (
                  <button key={platform.id} type="button" aria-pressed={form.platforms.includes(platform.id)} disabled={locked} onClick={() => togglePlatform(platform.id)}>{platform.label}</button>
                ))}
              </div>
            </fieldset>

            <section className={`so-media so-fmt-${form.format}`}>
              <FieldLabel>Picture or video</FieldLabel>
              <MediaPreview saved={saved} format={form.format} />
              {!locked && <MediaUpload hasMedia={Boolean(saved?.mediaPath)} busy={busy} onUpload={upload} onRemove={removeMedia} />}
              <p className="fd-note tight">Up to 50 MB. JPG, PNG, WebP, GIF, MP4, MOV or WebM. Only you can see it.</p>
            </section>

          </div>

          {problem && <p className="so-problem" role="alert">{problem}</p>}
          {message && <output className={`so-message${message.error ? ' error' : ''}`}>{message.text}</output>}

          {publishing && saved && (
            <PublishForm publishing={publishing} busy={busy} onChange={setPublishing} onPublish={publish} onCancel={() => setPublishing(null)} />
          )}

          <ActionBar
            saved={saved}
            locked={locked}
            dirty={dirty}
            busy={busy}
            publishing={publishing !== null}
            onReady={markReady}
            onStartPublish={(ready) => setPublishing({ platform: ready.platforms[0] ?? 'instagram', link: '' })}
            onDraft={() => setDraftStatus('draft')}
            onUnpublish={unpublish}
          />

          {saved && (
            <MoreMenu locked={locked} busy={busy} moveTo={moveTo} onMoveTo={setMoveTo} onDuplicate={duplicate} onMove={move} onRemove={remove} />
          )}
        </form>
      )}
    </div>
  );
}
