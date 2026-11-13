'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { LoaderCircle, SquarePlay } from 'lucide-react';
import { CATEGORIES, DESCRIPTION_MAX, TAGS_MAX, TITLE_MAX, tagsLength } from '@/lib/youtube/details';
import type { Privacy, VideoDetails } from '@/lib/youtube/types';

const PRIVACY_LABEL: Record<Privacy, string> = { public: 'Public', unlisted: 'Unlisted', private: 'Private' };

/** YouTube counts characters, not UTF-16 units: an emoji is one. */
const length = (text: string) => [...text].length;

const readTags = (text: string) => text.split(',').map((tag) => tag.trim()).filter(Boolean);

function Count({ used, max }: Readonly<{ used: number; max: number }>) {
  return <span className={`sh-yt-count${used > max ? ' is-over' : ''}`}>{used}/{max}</span>;
}

/**
 * What goes to YouTube with a short: title, description, tags and settings.
 * A native modal <dialog>, so Esc closes it and focus stays inside. It closes
 * itself after a save that worked; onClose runs whichever way it closes.
 */
export function YouTubeSheet({ initial, editing = false, onSave, onClose }: Readonly<{
  initial: VideoDetails;
  /** Editing a queued video ("Save") rather than adding a new one ("Save to queue"). */
  editing?: boolean;
  /** Resolves to null when it saved, or the message to show when it didn't. */
  onSave: (details: VideoDetails) => Promise<string | null>;
  onClose: () => void;
}>) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description);
  const [tagText, setTagText] = useState(initial.tags.join(', '));
  const [categoryId, setCategoryId] = useState(initial.categoryId);
  const [privacy, setPrivacy] = useState<Privacy>(initial.privacy);
  const [madeForKids, setMadeForKids] = useState(initial.madeForKids);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // Opened once, as a modal. Leaving the page removes it, so there's nothing to undo.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const tags = readTags(tagText);
  const titleUsed = length(title.trim());
  const descriptionUsed = length(description);
  const tagsUsed = tagsLength(tags);
  const valid = titleUsed > 0 && titleUsed <= TITLE_MAX && descriptionUsed <= DESCRIPTION_MAX && tagsUsed <= TAGS_MAX;
  const categories = CATEGORIES.some((category) => category.id === categoryId) ? CATEGORIES : [...CATEGORIES, { id: categoryId, label: `Category ${categoryId}` }];

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!valid || saving) return;
    setSaving(true);
    setProblem(null);
    const message = await onSave({ title: title.trim(), description: description.trim(), tags, categoryId, privacy, madeForKids });
    setSaving(false);
    if (message) return setProblem(message);
    dialogRef.current?.close();
  }

  return (
    <dialog ref={dialogRef} className="sh-yt-sheet" aria-labelledby="sh-yt-sheet-title" onClose={onClose}>
      <form className="sh-yt-form" onSubmit={(event) => void save(event)}>
        <h2 id="sh-yt-sheet-title" className="sh-h"><SquarePlay size={18} aria-hidden="true" /> {editing ? 'Edit for YouTube' : 'Add to YouTube'}</h2>

        <label className="fd-field">
          <span className="sh-yt-label">Title <Count used={titleUsed} max={TITLE_MAX} /></span>
          <input value={title} required onChange={(event) => setTitle(event.currentTarget.value)} />
        </label>

        <label className="fd-field">
          <span className="sh-yt-label">Description <Count used={descriptionUsed} max={DESCRIPTION_MAX} /></span>
          <textarea rows={5} value={description} onChange={(event) => setDescription(event.currentTarget.value)} />
        </label>

        <label className="fd-field">
          <span className="sh-yt-label">Tags <span className="sh-optional">split with commas</span> <Count used={tagsUsed} max={TAGS_MAX} /></span>
          <input value={tagText} spellCheck={false} onChange={(event) => setTagText(event.currentTarget.value)} />
        </label>

        <div className="sh-yt-pair">
          <label className="fd-field">
            Category
            <select value={categoryId} onChange={(event) => setCategoryId(event.currentTarget.value)}>
              {categories.map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}
            </select>
          </label>
          <label className="fd-field">
            Privacy
            <select value={privacy} onChange={(event) => setPrivacy(event.currentTarget.value as Privacy)}>
              {(Object.keys(PRIVACY_LABEL) as Privacy[]).map((one) => <option key={one} value={one}>{PRIVACY_LABEL[one]}</option>)}
            </select>
          </label>
        </div>

        <label className="fd-consent sh-yt-kids">
          <input type="checkbox" checked={madeForKids} onChange={(event) => setMadeForKids(event.currentTarget.checked)} />
          <span>Made for kids</span>
        </label>

        {problem && <p className="fd-msg bad" role="alert">{problem}</p>}

        <div className="sh-actions">
          <button type="submit" className="so-action primary" disabled={!valid || saving}>
            {saving ? <LoaderCircle className="workbook-spinner" size={16} aria-hidden="true" /> : <SquarePlay size={16} aria-hidden="true" />}
            <span>{editing ? 'Save' : 'Save to queue'}</span>
          </button>
          <button type="button" className="fd-link" onClick={() => dialogRef.current?.close()}>Cancel</button>
        </div>
      </form>
    </dialog>
  );
}
