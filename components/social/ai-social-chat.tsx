'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { Send, Paperclip, ChevronDown, RotateCcw, Copy, Check, Sparkles } from 'lucide-react';
import { draftMonthWithAiAction } from '@/app/social/actions';
import { safeAction } from '@/lib/client/safe-action';
import type { SocialPost } from '@/lib/social/types';

const CHIPS = [
  { label: 'Instagram caption', platform: 'instagram' as const, format: 'post' as const },
  { label: 'YouTube script', platform: 'youtube' as const, format: 'reel' as const },
  { label: 'X post', platform: 'x' as const, format: 'post' as const },
  { label: 'TikTok hook', platform: 'tiktok' as const, format: 'reel' as const },
  { label: 'Post idea', platform: 'instagram' as const, format: 'post' as const },
];

const PLATFORM_LABELS: Record<string, string> = {
  instagram: 'IG',
  x: 'X',
  facebook: 'FB',
  youtube: 'YT',
  tiktok: 'TT',
};

interface AiResponse {
  text: string;
  platforms: string[];
}

/**
 * Gemini-style AI content chat box for the Social screen.
 * Shows a greeting, suggestion chips, a chat input, and the last AI response.
 */
export function AiSocialChat({ period, hasProfile, onDrafted }: Readonly<{
  period: string;
  hasProfile: boolean;
  onDrafted?: (posts: SocialPost[], message: string) => void;
}>) {
  const [prompt, setPrompt] = useState('');
  const [activePlatform, setActivePlatform] = useState('All platforms');
  const [response, setResponse] = useState<AiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const chipsRef = useRef<HTMLDivElement>(null);

  function handleChip(chip: typeof CHIPS[number]) {
    setPrompt(chip.label);
    setActivePlatform(chip.platform === 'youtube' ? 'YouTube' : chip.platform === 'x' ? 'X' : chip.platform.charAt(0).toUpperCase() + chip.platform.slice(1));
    inputRef.current?.focus();
  }

  function submit(overridePrompt?: string) {
    const text = (overridePrompt ?? prompt).trim();
    if (!text || isPending) return;
    setError(null);
    setResponse(null);

    startTransition(async () => {
      const result = await safeAction(draftMonthWithAiAction)({
        period,
        brief: text,
        count: 1,
        formats: ['post'],
        platforms: ['instagram'],
        tone: 'friendly',
        useProfile: hasProfile,
      });

      if (result.success && result.posts?.length) {
        const post = result.posts[0];
        setResponse({
          text: post.body ?? post.title ?? 'Here is your draft!',
          platforms: ['IG', 'X', 'FB'],
        });
        onDrafted?.(result.posts, result.message ?? '');
      } else {
        setError(result.message ?? 'Something went wrong. Please try again.');
      }
    });
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  async function copyResponse() {
    if (!response) return;
    await navigator.clipboard.writeText(response.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // Auto-resize textarea
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [prompt]);

  const firstName = 'there'; // could be passed as prop later

  return (
    <section className="ai-chat-section" aria-label="AI content assistant">
      {/* Greeting */}
      {!response && !isPending && (
        <div className="ai-chat-greeting" aria-hidden={!!response}>
          <p className="ai-chat-hello">
            <span className="ai-chat-hello-line1">Hello, {firstName}.</span>
            <span className="ai-chat-hello-line2">What would you like to create?</span>
          </p>
        </div>
      )}

      {/* Suggestion chips */}
      {!response && !isPending && (
        <div className="ai-chat-chips" ref={chipsRef} role="list">
          {CHIPS.map((chip) => (
            <button
              key={chip.label}
              type="button"
              role="listitem"
              className="ai-chip"
              onClick={() => handleChip(chip)}
            >
              {chip.label}
            </button>
          ))}
        </div>
      )}

      {/* Loading state */}
      {isPending && (
        <div className="ai-chat-thinking" aria-live="polite">
          <span className="ai-thinking-dot" /><span className="ai-thinking-dot" /><span className="ai-thinking-dot" />
          <span className="ai-thinking-label">Creating your content…</span>
        </div>
      )}

      {/* AI Response card */}
      {response && !isPending && (
        <div className="ai-response-card" role="region" aria-label="AI generated content">
          <div className="ai-response-icon" aria-hidden="true">
            <Sparkles size={15} />
          </div>
          <p className="ai-response-text">{response.text}</p>
          <div className="ai-response-footer">
            <div className="ai-platform-badges" aria-label="Suggested platforms">
              {response.platforms.map((p) => (
                <span key={p} className="ai-badge">{p}</span>
              ))}
            </div>
            <div className="ai-response-actions">
              <button type="button" className="ai-action-btn primary" onClick={() => submit()}>
                Use this
              </button>
              <button type="button" className="ai-action-btn" onClick={() => submit()} title="Regenerate">
                <RotateCcw size={13} aria-hidden="true" />
              </button>
              <button type="button" className="ai-action-btn" onClick={copyResponse} title="Copy">
                {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Error */}
      {error && <p className="ai-chat-error" role="alert">{error}</p>}

      {/* Input area */}
      <div className="ai-chat-input-wrap">
        <button type="button" className="ai-input-btn" aria-label="Attach file">
          <Paperclip size={16} aria-hidden="true" />
        </button>
        <textarea
          ref={inputRef}
          className="ai-chat-input"
          placeholder="Ask Orbis to write something…"
          value={prompt}
          rows={1}
          disabled={isPending}
          onChange={(event) => setPrompt(event.currentTarget.value)}
          onKeyDown={handleKeyDown}
          aria-label="Content prompt"
        />
        <div className="ai-input-right">
          <button type="button" className="ai-platform-select" aria-label="Select platform">
            {activePlatform} <ChevronDown size={12} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={`ai-send-btn${prompt.trim() && !isPending ? ' active' : ''}`}
            disabled={!prompt.trim() || isPending}
            onClick={() => submit()}
            aria-label="Send"
          >
            <Send size={15} aria-hidden="true" />
          </button>
        </div>
      </div>
    </section>
  );
}
