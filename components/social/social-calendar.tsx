'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { PostRow, dayLabel } from '@/components/social/social-list';
import { monthGrid, placePosts } from '@/lib/social/month';
import { SOCIAL_FORMATS, SOCIAL_STATUS_LABEL, formatLabel, type SocialPost } from '@/lib/social/types';

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const WEEKDAY_REST = ['on', 'ue', 'ed', 'hu', 'ri', 'at', 'un'];
const DOTS_PER_DAY = 3;
const TITLES_PER_DAY = 2;

/**
 * The planner, the Social tab's signature: a Monday-start month where each post
 * shows in its format's colour (hollow until it is ready), and the chosen day's
 * posts listed beside it. On the phone each post is a dot and the grid is a
 * week tall until the month is asked for; on desktop the whole month shows,
 * with the posts' titles written into the days like a wall planner.
 */
export function SocialCalendar({ period, posts, today, selected, loading = false, onSelect, onOpen, onNew }: Readonly<{
  period: string;
  posts: SocialPost[];
  today: string;
  selected: string | null;
  loading?: boolean;
  onSelect: (date: string) => void;
  onOpen: (post: SocialPost) => void;
  onNew: (date: string | null) => void;
}>) {
  const { byDay } = placePosts(posts);
  const weeks = monthGrid(period);
  const chosen = selected?.startsWith(period.slice(0, 8)) ? selected : null;
  const dayPosts = chosen ? byDay.get(chosen) ?? [] : [];
  // A week tall on the phone until the month is asked for: the week of the
  // chosen day, or of today, or the month's first week when neither falls in it.
  const [expanded, setExpanded] = useState(false);
  const anchor = chosen ?? (today.startsWith(period.slice(0, 8)) ? today : null);
  const anchorWeek = (anchor && weeks.find((week) => week.some((day) => day.date === anchor))) || weeks[0];

  return (
    <section className={`so-calcard${expanded ? ' open' : ''}`} aria-label="Calendar" aria-busy={loading || undefined}>
      <div className="so-cal">
        <div className="so-cal-bar">
          <span className="so-legend">
            {SOCIAL_FORMATS.map((format) => <span key={format.id}><i className={`so-dot so-fmt-${format.id}`} />{format.label}</span>)}
            <span><i className="so-dot so-fmt-post draft" />Not ready yet</span>
          </span>
          <button type="button" className="fd-link so-cal-toggle" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? 'Show week' : 'Show month'}</button>
        </div>
        <div className="so-cal-head" aria-hidden="true">{WEEKDAYS.map((day, index) => <span key={index}><b>{day}</b><span>{WEEKDAY_REST[index]}</span></span>)}</div>
        {weeks.map((week) => (
          <div className={`so-cal-week${week === anchorWeek ? ' anchor' : ''}`} key={week[0].date}>
            {week.map(({ date, inMonth }) => {
              const onDay = byDay.get(date) ?? [];
              const described = onDay.map((post) => `${post.title}, ${formatLabel(post.format)}, ${SOCIAL_STATUS_LABEL[post.status]}`).join('; ');
              const planned = onDay.length ? `: ${described}` : ', nothing planned';
              if (!inMonth) return <span key={date} className="so-day out" aria-hidden="true"><b>{Number(date.slice(8))}</b></span>;
              return (
                <button
                  key={date}
                  type="button"
                  className={`so-day${date === today ? ' today' : ''}${date < today ? ' past' : ''}`}
                  aria-pressed={chosen === date}
                  aria-label={`${dayLabel(date)}${planned}`}
                  onClick={() => onSelect(date)}
                >
                  <b>{Number(date.slice(8))}</b>
                  {onDay.length > 0 && (
                    <span className="so-dots" aria-hidden="true">
                      {onDay.slice(0, DOTS_PER_DAY).map((post) => <i key={post.id} className={`so-dot so-fmt-${post.format} ${post.status}`} />)}
                      {onDay.length > DOTS_PER_DAY && <span className="so-more">+{onDay.length - DOTS_PER_DAY}</span>}
                    </span>
                  )}
                  {/* Desktop: the titles themselves, written into the day. */}
                  {onDay.length > 0 && (
                    <span className="so-day-posts" aria-hidden="true">
                      {onDay.slice(0, TITLES_PER_DAY).map((post) => <span key={post.id} className={`so-chip so-fmt-${post.format} ${post.status}`}>{post.title}</span>)}
                      {onDay.length > TITLES_PER_DAY && <span className="so-more">{onDay.length - TITLES_PER_DAY} more</span>}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/* The chosen day. Posts without a day are in the list below, marked "No date". */}
      <div className="so-dayplan" aria-live="polite">
        {chosen ? (
          <>
            <h3 className="so-dayplan-title">{dayLabel(chosen)}{chosen === today && <span>Today</span>}</h3>
            {dayPosts.map((post) => <PostRow key={post.id} post={post} onOpen={onOpen} />)}
            {!dayPosts.length && <p className="fd-empty">Nothing planned for this day.</p>}
            <button type="button" className="so-add-day" onClick={() => onNew(chosen)}><Plus size={15} aria-hidden="true" />New post on {dayLabel(chosen)}</button>
          </>
        ) : (
          <p className="so-dayplan-hint">Pick a day to see what is planned, or to add a post to it.</p>
        )}
      </div>
    </section>
  );
}
