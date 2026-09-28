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
  return String(value);
}

function HistoryList({ history }: { history: SocialRevision[] }) {
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
                        <del>{key === 'mediaPath' ? (entry.previous?.[key] ? 'A file' : '—') : show(entry.previous?.[key])}</del>
                        {' → '}
                        <ins>{key === 'mediaPath' ? (entry.snapshot?.[key] ? 'A new file' : 'Removed') : show(entry.snapshot?.[key])}</ins>
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

/**
 * One post, full screen: write it, attach its picture or video, mark it ready,
 * record where it went out, and read what changed.
 *
 * Each write disables only the button that was pressed. The server makes every
 * status change conditional on what it read, so two taps cannot corrupt a post.
 */
export function PostDrawer({ period, post, initialDate, initialFormat = 'post', onClose, onChanged, onRemoved }: {
  period: string;
  post: SocialPost | null;
  initialDate: string | null;
  initialFormat?: SocialFormat;
  onClose: () => void;
  /** A post was created or changed (it may now belong to another month). */
  onChanged: (post: SocialPost) => void;
  onRemoved: (id: string) => void;
}) {
  const [saved, setSaved] = useState<SocialPost | null>(post);
  const [form, setForm] = useState<Form>(() => (post ? formOf(post, null) : { ...formOf(null, initialDate), format: initialFormat }));
  // A new post's id is chosen here, so a second tap on Save finds the first post instead of making another.
  const [clientId] = useState(() => crypto.randomUUID());
  const [tab, setTab] = useState<'edit' | 'history'>('edit');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [publishing, setPublishing] = useState<{ platform: string; link: string } | null>(null);
  const [history, setHistory] = useState<SocialRevision[] | null>(null);
  const [moveTo, setMoveTo] = useState('');
  const [, startTransition] = useTransition();
  const fileId = useId();

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
    accept(result.post, droppedToDraft ? 'Saved. It is back to draft — mark it ready again when you are happy with it.' : result.message);
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

  const label = (key: string, idle: string, working: string) => (busy === key ? working : idle);

  return (
    <div className="so-drawer">
      <FieldSubHead
        crumb={`Social · ${monthName(postPeriod)}`}
        title={saved ? saved.title : 'New post'}
        onClose={onClose}
        backLabel="Close post"
        lead={saved && (
          <span className="so-tags">
            <StatusChip status={saved.status} />
            {saved.source === 'ai' && <span className="so-ai"><Sparkles size={9} aria-hidden="true" />AI draft</span>}
            <span>{formatLabel(saved.format)}{saved.plannedFor ? ` · ${dayLabel(saved.plannedFor)}` : ' · no date yet'}</span>
          </span>
        )}
      />

      {saved && (
        <div className="fd-tabs" role="tablist" aria-label="Post views">
          <button type="button" role="tab" aria-selected={tab === 'edit'} onClick={() => setTab('edit')}>Post</button>
          <button type="button" role="tab" aria-selected={tab === 'history'} onClick={openHistory}>History</button>
        </div>
      )}

      {tab === 'history' && saved ? (
        <section className="so-history">
          {history ? <HistoryList history={history} /> : <p className="fd-empty">{busy === 'history' ? 'Loading…' : 'History could not be loaded.'}</p>}
        </section>
      ) : (
        <form className="fd-form" onSubmit={(event) => { event.preventDefault(); save(); }}>
          {locked && saved?.published && (
            <p className="so-published-note">
              Published on {platformLabel(saved.published.platform)}, {new Date(saved.published.at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' })}.
              {saved.published.link && <> <a href={saved.published.link} target="_blank" rel="noopener noreferrer">Open the post</a></>}
              {' '}Mark it as not published to change it.
            </p>
          )}

          <div className="fd-seg" role="radiogroup" aria-label="Format">
            {SOCIAL_FORMATS.map((format) => (
              <button key={format.id} type="button" role="radio" aria-checked={form.format === format.id} disabled={locked} onClick={() => setForm({ ...form, format: format.id })}>{format.label}</button>
            ))}
          </div>

          <div className="so-row-2">
            <label className="fd-field wide">Day
              <input type="date" value={form.plannedFor} min={postPeriod} max={lastDay} disabled={locked} onChange={(event) => setForm({ ...form, plannedFor: event.currentTarget.value })} />
            </label>
            {saved && saved.status !== 'ready' && saved.status !== 'published' ? (
              <label className="fd-field wide">Stage
                <select value={saved.status} disabled={busy !== null} onChange={(event) => setDraftStatus(event.currentTarget.value as 'idea' | 'draft')}>
                  <option value="idea">Idea</option>
                  <option value="draft">Draft</option>
                </select>
              </label>
            ) : <span />}
          </div>

          <label className="fd-field wide">Title
            <input value={form.title} maxLength={SOCIAL_CAPS.title} required disabled={locked} placeholder="What this post is about" onChange={(event) => setForm({ ...form, title: event.currentTarget.value })} />
          </label>
          <label className="fd-field wide">Headline <span>(optional, the words on the image)</span>
            <input value={form.headline} maxLength={SOCIAL_CAPS.headline} disabled={locked} onChange={(event) => setForm({ ...form, headline: event.currentTarget.value })} />
          </label>
          <label className="fd-field wide">Caption
            <textarea rows={7} value={form.caption} maxLength={SOCIAL_CAPS.caption} disabled={locked} onChange={(event) => setForm({ ...form, caption: event.currentTarget.value })} />
          </label>
          <p className="so-counter" aria-live="polite">
            {form.platforms.length
              ? form.platforms.map((platform) => (
                <span key={platform} className={length > CAPTION_LIMIT[platform] ? 'over' : undefined}>
                  {platformLabel(platform)} {length.toLocaleString('en-IN')} / {CAPTION_LIMIT[platform].toLocaleString('en-IN')}{length > CAPTION_LIMIT[platform] ? ' — too long' : ''}
                </span>
              ))
              : <span>{length.toLocaleString('en-IN')} characters, hashtags included</span>}
          </p>
          <label className="fd-field wide">Hashtags
            <input value={form.hashtags} disabled={locked} placeholder="#autumn #recipes" onChange={(event) => setForm({ ...form, hashtags: event.currentTarget.value })} />
          </label>

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
            <div className="so-media-frame">
              {saved?.mediaUrl && saved.mediaType === 'image' && <img src={saved.mediaUrl} alt={`Picture for ${saved.title}`} />}
              {saved?.mediaUrl && saved.mediaType === 'video' && <video src={saved.mediaUrl} controls playsInline preload="metadata" />}
              {!saved?.mediaPath && (
                <p className="so-media-empty">{form.format === 'post' ? 'Optional for a post.' : `A ${form.format} needs one before it can be marked ready.`}</p>
              )}
              {saved?.mediaPath && !saved.mediaUrl && <p className="so-media-empty">The file is saved but could not be shown right now.</p>}
            </div>
            {!locked && (
              <div className="fd-act">
                <label htmlFor={fileId} className="fd-button ghost" aria-disabled={busy === 'media'}>
                  <Upload size={14} aria-hidden="true" />{label('media', saved?.mediaPath ? 'Replace' : 'Upload', 'Uploading…')}
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
                    if (file) upload(file);
                  }}
                />
                {saved?.mediaPath && <button type="button" className="fd-link" disabled={busy === 'media-remove'} onClick={removeMedia}>{label('media-remove', 'Remove', 'Removing…')}</button>}
              </div>
            )}
            <p className="fd-note tight">Up to 50 MB. JPG, PNG, WebP, GIF, MP4, MOV or WebM. Only you can see it.</p>
          </section>

          {problem && <p className="so-problem" role="alert">{problem}</p>}
          {message && <p className={`so-message${message.error ? ' error' : ''}`} role="status">{message.text}</p>}

          {publishing && saved && (
            <div className="so-publish">
              <label className="fd-field">Where did it go out?
                <select value={publishing.platform} onChange={(event) => setPublishing({ ...publishing, platform: event.currentTarget.value })}>
                  {PUBLISH_PLACES.map((place) => <option key={place.id} value={place.id}>{place.label}</option>)}
                </select>
              </label>
              <label className="fd-field wide">Link (optional)
                <input type="url" inputMode="url" placeholder="https://" value={publishing.link} onChange={(event) => setPublishing({ ...publishing, link: event.currentTarget.value })} />
              </label>
              <div className="fd-act">
                <button type="button" disabled={busy === 'publish'} onClick={publish}>{label('publish', 'Mark published', 'Saving…')}</button>
                <button type="button" className="fd-link" onClick={() => setPublishing(null)}>Cancel</button>
              </div>
            </div>
          )}

          <div className="so-bar">
            <div className="fd-act">
              {!locked && <button type="submit" disabled={busy === 'save' || (!dirty && Boolean(saved))}>{label('save', saved ? 'Save' : 'Add post', 'Saving…')}</button>}
              {(!saved || saved.status === 'idea' || saved.status === 'draft') && (
                <button type="button" className="ghost" disabled={busy === 'ready'} onClick={markReady}>{label('ready', 'Mark ready', 'Checking…')}</button>
              )}
              {saved?.status === 'ready' && !publishing && (
                <button type="button" className="ghost" onClick={() => setPublishing({ platform: saved.platforms[0] ?? 'instagram', link: '' })}>Mark published</button>
              )}
              {saved?.status === 'ready' && (
                <button type="button" className="fd-link" disabled={busy === 'draft'} onClick={() => setDraftStatus('draft')}>{label('draft', 'Back to draft', 'Saving…')}</button>
              )}
              {locked && <button type="button" className="ghost" disabled={busy === 'unpublish'} onClick={unpublish}>{label('unpublish', 'Mark as not published', 'Saving…')}</button>}
            </div>
          </div>

          {saved && (
            <details className="so-more-menu">
              <summary>More: copy, move or delete</summary>
              <div className="fd-act">
                <button type="button" className="ghost" disabled={busy === 'duplicate'} onClick={duplicate}>{label('duplicate', 'Duplicate', 'Copying…')}</button>
                {!locked && (
                  <>
                    <label className="fd-field">Move to
                      <input type="month" value={moveTo} onChange={(event) => setMoveTo(event.currentTarget.value)} />
                    </label>
                    <button type="button" className="ghost" disabled={!moveTo || busy === 'move'} onClick={move}>{label('move', 'Move', 'Moving…')}</button>
                  </>
                )}
                <button type="button" className="fd-link alert" disabled={busy === 'delete'} onClick={remove}><Trash2 size={13} aria-hidden="true" />{label('delete', 'Delete', 'Deleting…')}</button>
              </div>
            </details>
          )}
        </form>
      )}
    </div>
  );
}
