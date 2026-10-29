'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { Check, Copy, PenLine, RotateCcw, Send, Sparkles } from 'lucide-react';
import { deletePostAction, draftMonthWithAiAction } from '@/app/social/actions';
import { safeAction } from '@/lib/client/safe-action';
import { MAX_BRIEF_LENGTH } from '@/lib/social/ai-draft';
import { SOCIAL_FORMATS, SOCIAL_PLATFORMS, formatLabel, platformLabel, type SocialFormat, type SocialPlatform, type SocialPost } from '@/lib/social/types';

/** Shortcuts: each one only picks the platform and format; the user still says what it is about. */
const CHIPS: ReadonlyArray<{ label: string; platform: SocialPlatform; format: SocialFormat }> = [
  { label: 'Instagram caption', platform: 'instagram', format: 'post' },
  { label: 'Instagram reel', platform: 'instagram', format: 'reel' },
  { label: 'LinkedIn post', platform: 'linkedin', format: 'post' },
  { label: 'X post', platform: 'x', format: 'post' },
  { label: 'YouTube short', platform: 'youtube', format: 'reel' },
  { label: 'TikTok hook', platform: 'tiktok', format: 'reel' },
];

/** The draft on show, and the request that made it, so "Try another" can ask again. */
type Reply = { post: SocialPost; brief: string; platform: SocialPlatform; format: SocialFormat };

const withHashtags = (post: SocialPost) => [post.caption, post.hashtags.map((tag) => `#${tag}`).join(' ')].filter(Boolean).join('\n\n');

/**
 * The chat box at the top of the Social tab: one sentence in, one draft out.
 *
 * Every draft is saved to the month straight away, like the month dialog's.
 * "Try another" swaps the draft on show for a new one; "Edit" opens it. Only
 * the sentence typed here is sent, never the profile.
 */
export function AiSocialChat({ period, preferredName, onDrafted, onReplaced, onOpen }: Readonly<{
  period: string;
  preferredName: string | null;
  onDrafted: (post: SocialPost, message: string) => void;
  onReplaced: (id: string) => void;
  onOpen: (post: SocialPost) => void;
}>) {
  const [brief, setBrief] = useState('');
  const [platform, setPlatform] = useState<SocialPlatform>('instagram');
  const [format, setFormat] = useState<SocialFormat>('post');
  const [reply, setReply] = useState<Reply | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLTextAreaElement>(null);

  function pickChip(chip: typeof CHIPS[number]) {
    setPlatform(chip.platform);
    setFormat(chip.format);
    inputRef.current?.focus();
  }

  /** Drafts one post; given the draft on show, the new one replaces it. */
  function draft(request: Omit<Reply, 'post'>, replacing: SocialPost | null) {
    if (!request.brief || isPending) return;
    setError(null);
    startTransition(async () => {
      const result = await safeAction(draftMonthWithAiAction)({
        period,
        brief: request.brief,
        count: 1,
        formats: [request.format],
        platforms: [request.platform],
        tone: 'friendly',
        useProfile: false,
      });
      const post = result.success ? result.posts?.[0] : undefined;
      if (!post) {
        setError(result.message);
        return;
      }
      setReply({ ...request, post });
      setBrief('');
      onDrafted(post, result.message);
      // The old draft goes only once its replacement is saved; if it can't be deleted it simply stays in the list.
      if (replacing) {
        const removed = await safeAction(deletePostAction)(replacing.id);
        if (removed.success) onReplaced(replacing.id);
      }
    });
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      draft({ brief: brief.trim(), platform, format }, null);
    }
  }

  async function copyReply() {
    if (!reply) return;
    try {
      await navigator.clipboard.writeText(withHashtags(reply.post));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Copying is blocked in this browser. Open the draft and copy it from there.');
    }
  }

  // The box grows with what is typed, up to a few lines.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [brief]);

  const name = preferredName?.trim();
  const canSend = Boolean(brief.trim()) && !isPending;

  return (
    <section className="ai-chat-section" aria-label="Draft a post with AI">
      {!reply && !isPending && (
        <>
          <div className="ai-chat-greeting">
            <p className="ai-chat-hello">
              <span className="ai-chat-hello-line1">{name ? `Hello, ${name}.` : 'Hello.'}</span>
              <span className="ai-chat-hello-line2">What would you like to post?</span>
            </p>
          </div>
          <div className="ai-chat-chips">
            {CHIPS.map((chip) => (
              <button key={chip.label} type="button" className="ai-chip" aria-pressed={platform === chip.platform && format === chip.format} onClick={() => pickChip(chip)}>
                {chip.label}
              </button>
            ))}
          </div>
        </>
      )}

      {isPending && (
        <div className="ai-chat-thinking" aria-live="polite">
          <span className="ai-thinking-dot" /><span className="ai-thinking-dot" /><span className="ai-thinking-dot" />
          <span className="ai-thinking-label">Drafting… this can take half a minute</span>
        </div>
      )}

      {reply && !isPending && (
        <div className="ai-response-card" role="region" aria-label="AI draft">
          <div className="ai-response-icon" aria-hidden="true"><Sparkles size={15} /></div>
          {reply.post.title && <strong className="ai-response-title">{reply.post.title}</strong>}
          <p className="ai-response-text">{withHashtags(reply.post) || 'This draft has no caption yet.'}</p>
          <div className="ai-response-footer">
            <div className="ai-platform-badges" aria-label="Planned for">
              <span className="ai-badge">{formatLabel(reply.post.format)}</span>
              {reply.post.platforms.map((item) => <span key={item} className="ai-badge">{platformLabel(item)}</span>)}
            </div>
            <div className="ai-response-actions">
              <button type="button" className="ai-action-btn primary" onClick={() => onOpen(reply.post)}>
                <PenLine size={13} aria-hidden="true" /> Edit
              </button>
              <button type="button" className="ai-action-btn" onClick={() => draft(reply, reply.post)} title="Try another (replaces this draft)" aria-label="Try another, replacing this draft">
                <RotateCcw size={13} aria-hidden="true" />
              </button>
              <button type="button" className="ai-action-btn" onClick={copyReply} title="Copy caption" aria-label="Copy caption">
                {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
              </button>
            </div>
          </div>
          <p className="ai-response-note">Saved to {reply.post.plannedFor ? 'the calendar' : 'this month'} as a draft.</p>
        </div>
      )}

      {error && <p className="ai-chat-error" role="alert">{error}</p>}

      <form className="ai-chat-input-wrap" onSubmit={(event) => { event.preventDefault(); draft({ brief: brief.trim(), platform, format }, null); }}>
        <textarea
          ref={inputRef}
          className="ai-chat-input"
          placeholder={`What should the ${formatLabel(format).toLowerCase()} be about?`}
          value={brief}
          rows={1}
          maxLength={MAX_BRIEF_LENGTH}
          disabled={isPending}
          onChange={(event) => setBrief(event.currentTarget.value)}
          onKeyDown={handleKeyDown}
          aria-label="What the post is about"
        />
        <div className="ai-input-right">
          <select className="ai-platform-select" aria-label="Format" value={format} disabled={isPending} onChange={(event) => setFormat(event.currentTarget.value as SocialFormat)}>
            {SOCIAL_FORMATS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
          <select className="ai-platform-select" aria-label="Platform" value={platform} disabled={isPending} onChange={(event) => setPlatform(event.currentTarget.value as SocialPlatform)}>
            {SOCIAL_PLATFORMS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
          <button type="submit" className={`ai-send-btn${canSend ? ' active' : ''}`} disabled={!canSend} aria-label="Draft it">
            <Send size={15} aria-hidden="true" />
          </button>
        </div>
      </form>
    </section>
  );
}
