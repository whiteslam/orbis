'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { FieldLabel } from '@/components/field/field';
import { PostRow, dayLabel } from '@/components/social/social-list';
import { monthGrid, placePosts } from '@/lib/social/month';
import { SOCIAL_FORMATS, SOCIAL_STATUS_LABEL, formatLabel, type SocialPost } from '@/lib/social/types';

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const DOTS_PER_DAY = 3;

/**
 * The month at a glance, sized for a phone: a Monday-start grid where each post
 * is a dot in its format's colour (hollow until it is ready), and the chosen
 * day's posts listed underneath. Posts without a day wait in their own tray.
 */
export function SocialCalendar({ period, posts, today, selected, onSelect, onOpen, onNew }: {
  period: string;
  posts: SocialPost[];
  today: string;
  selected: string | null;
  onSelect: (date: string) => void;
  onOpen: (post: SocialPost) => void;
  onNew: (date: string | null) => void;
}) {
  const { byDay } = placePosts(posts);
  const weeks = monthGrid(period);
  const chosen = selected && selected.startsWith(period.slice(0, 8)) ? selected : null;
  const dayPosts = chosen ? byDay.get(chosen) ?? [] : [];
  // A week tall until the month is asked for: the week of the chosen day, or of
  // today, or the month's first week when neither falls in it.
  const [expanded, setExpanded] = useState(false);
  const anchor = chosen ?? (today.startsWith(period.slice(0, 8)) ? today : null);
  const shownWeeks = expanded ? weeks : [(anchor && weeks.find((week) => week.some((day) => day.date === anchor))) || weeks[0]];

  return (
    <section className="mn-card so-calcard" aria-label="Calendar">
      <div className="fd-label-row">
        <FieldLabel>{new Date(`${period}T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</FieldLabel>
        <button type="button" className="fd-link" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? 'Show week' : 'Show month'}</button>
      </div>
      <div className="so-cal">
        <div className="so-cal-head" aria-hidden="true">{WEEKDAYS.map((day, index) => <span key={index}>{day}</span>)}</div>
        {shownWeeks.map((week) => (
          <div className="so-cal-week" key={week[0].date}>
            {week.map(({ date, inMonth }) => {
              const onDay = byDay.get(date) ?? [];
              const described = onDay.map((post) => `${post.title}, ${formatLabel(post.format)}, ${SOCIAL_STATUS_LABEL[post.status]}`).join('; ');
              if (!inMonth) return <span key={date} className="so-day out" aria-hidden="true"><b>{Number(date.slice(8))}</b></span>;
              return (
                <button
                  key={date}
                  type="button"
                  className={`so-day${date === today ? ' today' : ''}`}
                  aria-pressed={chosen === date}
                  aria-label={`${dayLabel(date)}${onDay.length ? `: ${described}` : ', nothing planned'}`}
                  onClick={() => onSelect(date)}
                >
                  <b>{Number(date.slice(8))}</b>
                  {onDay.length > 0 && (
                    <span className="so-dots" aria-hidden="true">
                      {onDay.slice(0, DOTS_PER_DAY).map((post) => <i key={post.id} className={`so-dot so-fmt-${post.format} ${post.status}`} />)}
                      {onDay.length > DOTS_PER_DAY && <span className="so-more">+{onDay.length - DOTS_PER_DAY}</span>}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
        {expanded && (
          <p className="so-legend">
            {SOCIAL_FORMATS.map((format) => <span key={format.id}><i className={`so-dot so-fmt-${format.id}`} />{format.label}</span>)}
            <span><i className="so-dot so-fmt-post draft" />Not ready yet</span>
          </p>
        )}
      </div>

      {/* The chosen day. Posts without a day are in the Posts card below, marked "No date". */}
      {chosen && (
        <div className="so-group" aria-live="polite">
          <FieldLabel>{dayLabel(chosen)}</FieldLabel>
          {dayPosts.map((post) => <PostRow key={post.id} post={post} onOpen={onOpen} />)}
          {!dayPosts.length && <p className="fd-empty">Nothing planned for this day.</p>}
          <button type="button" className="so-add-day" onClick={() => onNew(chosen)}><Plus size={14} aria-hidden="true" />New post on {dayLabel(chosen)}</button>
        </div>
      )}
    </section>
  );
}
