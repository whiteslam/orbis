'use client';

import { useCallback, useRef, useState } from 'react';
import { Bell, CalendarClock, HandCoins, Inbox, MessageCircleQuestion, Moon, Reply, Settings2, Sun } from 'lucide-react';
import { OrbisMark } from '@/components/brand/orbis-mark';
import { UnmatchedReply } from '@/components/career/tracker-view';
import { useDismiss } from '@/components/career/panel/panel-bits';
import { usePanel } from '@/components/career/panel/panel-context';
import { useTheme } from '@/components/career/panel/panel-hooks';
import { PANEL_NAV, allApplications, hrefFor, navOf, panelHeadsups, type PanelHeadsup, type PanelPage } from '@/components/career/panel/panel-data';
import { isOpen } from '@/lib/career/status';
import { DESKTOP_LAYOUT } from '@/lib/shell/desktop';

const HEADSUP_ICON: Record<PanelHeadsup['kind'], typeof Bell> = {
  interview: CalendarClock,
  offer: HandCoins,
  question: MessageCircleQuestion,
  follow_up: Reply,
};

function CountBadge({ count, what }: Readonly<{ count: number; what: string }>) {
  if (count <= 0) return null;
  return <span className="cp-count"><span className="sr-only">, </span>{count > 99 ? '99+' : count}<span className="sr-only"> {what}</span></span>;
}

/** Replies Orbis found but couldn't link, each with the house's attach control. */
function InboxButton() {
  const { home, reload } = usePanel();
  const [open, setOpen] = useState(false);
  const [attached, setAttached] = useState<string[]>([]);
  const box = useRef<HTMLDivElement | null>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, box, close);
  const unmatched = (home?.unmatched ?? []).filter((event) => !attached.includes(event.id));
  const options = home ? allApplications(home).filter((card) => isOpen(card.application.status) || card.application.status === 'ghosted') : [];
  return (
    <div className="cp-pop-wrap" ref={box}>
      <button type="button" className="cp-head-btn" aria-expanded={open} aria-controls="cp-inbox" onClick={() => setOpen((value) => !value)} title="Unmatched replies">
        <Inbox size={18} aria-hidden="true" />
        <span className="sr-only">Unmatched replies</span>
        <CountBadge count={unmatched.length} what="to attach" />
      </button>
      {open && (
        <div className="cp-pop" id="cp-inbox" role="dialog" aria-labelledby="cp-inbox-title">
          <h2 id="cp-inbox-title">Unmatched replies</h2>
          {unmatched.length === 0 ? <p className="cp-pop-empty">Every reply Orbis found is linked to its application.</p> : (
            <>
              <p className="cp-pop-note">Orbis found these in your Gmail but couldn’t tell which application they answer. Attach each one.</p>
              <ul className="cp-pop-list">
                {unmatched.map((event) => (
                  <UnmatchedReply key={event.id} event={event} options={options} onAttached={() => { setAttached((ids) => [...ids, event.id]); reload(); }} />
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** What would raise a Career heads-up now: interviews soon, offers, questions and follow-ups. */
function NotifyButton() {
  const { home, openJobId } = usePanel();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement | null>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, box, close);
  const items = home ? panelHeadsups(home) : [];
  const urgent = items.some((item) => item.urgent);
  return (
    <div className="cp-pop-wrap" ref={box}>
      <button type="button" className={`cp-head-btn${urgent ? ' urgent' : ''}`} aria-expanded={open} aria-controls="cp-notify" onClick={() => setOpen((value) => !value)} title="Needs you">
        <Bell size={18} aria-hidden="true" />
        <span className="sr-only">Needs you</span>
        <CountBadge count={items.length} what={items.length === 1 ? 'item' : 'items'} />
      </button>
      {open && (
        <div className="cp-pop" id="cp-notify" role="dialog" aria-labelledby="cp-notify-title">
          <h2 id="cp-notify-title">Needs you</h2>
          {items.length === 0 ? <p className="cp-pop-empty">Nothing is waiting on you. Orbis tells you when a reply needs an answer.</p> : (
            <ul className="cp-notes">
              {items.map((item) => {
                const Icon = HEADSUP_ICON[item.kind];
                return (
                  <li key={item.id}>
                    <button type="button" onClick={() => { setOpen(false); openJobId(item.jobId); }}>
                      <span className={`cp-note-icon k-${item.kind}`} aria-hidden="true"><Icon size={15} /></span>
                      <span className="cp-note-text"><b>{item.title}</b><small>{item.detail}</small></span>
                      {item.urgent && <span className="cp-note-flag">Soon</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/** Light or dark, beside the bell, for the desktop layout, whose rail is navigation only. Hidden below 900px, where the bottom bar has it. */
function ThemeButton() {
  const { theme, toggle } = useTheme();
  const toLight = theme === 'dark';
  const label = toLight ? 'Switch to light appearance' : 'Switch to dark appearance';
  return (
    <button type="button" className="cp-head-btn cp-head-theme" onClick={toggle} title={label}>
      {toLight ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
      <span className="sr-only">{label}</span>
    </button>
  );
}

/**
 * The top bar: the mark and "Career", the three destinations (Home, Jobs,
 * Applications), then Profile and settings, the inbox, the heads-ups and who's signed in.
 */
export function PanelHeader({ page, who }: Readonly<{ page: PanelPage; who: string | null }>) {
  const initial = (who?.trim()[0] ?? 'O').toUpperCase();
  const here = navOf(page)?.id ?? null;
  return (
    <header className="cp-header">
      <a className="cp-brand" href={hrefFor('overview')}>
        <OrbisMark size={30} />
        <span>Career</span>
      </a>
      <nav className="cp-nav" aria-label="Career pages">
        {/* data-glide: the selection slides between pages (components/motion/motion-runtime.tsx). */}
        <ul className="cp-nav-list" data-glide="">
          {PANEL_NAV.map(({ id, label }) => (
            <li key={id}>
              <a href={hrefFor(id)} aria-current={here === id ? 'page' : undefined}>{label}</a>
            </li>
          ))}
        </ul>
      </nav>
      <div className="cp-head-tools">
        {DESKTOP_LAYOUT && <ThemeButton />}
        <a className={`cp-head-btn cp-head-setup${page === 'setup' ? ' on' : ''}`} href={hrefFor('setup')} aria-current={page === 'setup' ? 'page' : undefined} title="Profile and settings">
          <Settings2 size={18} aria-hidden="true" />
          <span className="sr-only">Profile and settings</span>
        </a>
        <InboxButton />
        <NotifyButton />
        <span className="cp-avatar" role="img" aria-label={who ? `Signed in as ${who}` : 'Signed in'} title={who ?? undefined}>{initial}</span>
      </div>
    </header>
  );
}
