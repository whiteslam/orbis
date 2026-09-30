'use client';

import { useEffect, useRef, useState } from 'react';
import { checkPublishAction, startPublishAction } from '@/app/social/meta-actions';
import { safeAction } from '@/lib/client/safe-action';
import { sentText } from '@/lib/meta/publish-rules';
import { META_LABEL, type MetaPlatform, type PublishResult } from '@/lib/meta/types';
import { formatLabel, type SocialPost } from '@/lib/social/types';

const POLL_MS = 5_000;
const GIVE_UP_MS = 5 * 60_000;

/** Shows exactly what will go out, and only its Publish button sends anything. */
export function PublishSheet({ post, platform, username, onClose, onPublished }: { post: SocialPost; platform: MetaPlatform; username: string; onClose: () => void; onPublished: (message: string) => void }) {
  const [state, setState] = useState<'confirm' | 'sending' | 'processing'>('confirm');
  const [error, setError] = useState<string | null>(null);
  const started = useRef(0);
  const name = META_LABEL[platform];
  const text = sentText(post, platform);

  function settle(result: PublishResult) {
    if (!result.success) {
      setState('confirm');
      setError(result.message);
    } else if (result.state === 'published') {
      onPublished(result.message);
    } else {
      setState('processing');
      if (Date.now() - started.current > GIVE_UP_MS) {
        onPublished('Still processing. Orbis will finish it the next time Social opens.');
        return;
      }
      setTimeout(() => { void safeAction(checkPublishAction)(result.publicationId).then(settle); }, POLL_MS);
    }
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && state === 'confirm') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, state]);

  function publish() {
    setError(null);
    setState('sending');
    started.current = Date.now();
    // updatedAt is the version shown here: the server refuses a post changed since.
    void safeAction(startPublishAction)(post.id, platform, post.updatedAt).then(settle);
  }

  return (
    <div className="so-sheet" role="dialog" aria-modal="true" aria-labelledby="publish-title">
      <h3 id="publish-title">Publish to {name}</h3>
      <p className="so-sheet-who">@{username} · {formatLabel(post.format)}</p>
      {post.mediaUrl && (post.mediaType === 'video'
        ? <video src={post.mediaUrl} className="so-sheet-media" muted playsInline />
        // eslint-disable-next-line @next/next/no-img-element -- a signed, short-lived Storage URL
        : <img src={post.mediaUrl} alt="" className="so-sheet-media" />)}
      {text === null
        ? <p className="so-sheet-who">Stories carry no caption: only the picture or video goes out.</p>
        : <pre className="so-sheet-text" aria-label="Text that will be posted">{text}</pre>}
      <p className="so-sheet-warn">This posts publicly on {name} right now. Orbis can’t delete it afterwards.</p>
      {error && <p className="so-problem" role="alert">{error}</p>}
      {state === 'processing' && <p className="so-message" role="status">Publishing… {name} is processing the video.</p>}
      <div className="fd-act">
        <button type="button" disabled={state !== 'confirm'} onClick={publish}>{state === 'confirm' ? `Publish to ${name}` : 'Publishing…'}</button>
        {state === 'confirm' && <button type="button" className="fd-link" onClick={onClose}>Cancel</button>}
      </div>
    </div>
  );
}
