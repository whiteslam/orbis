'use client';

import type { ReactNode } from 'react';
import { ArrowLeft, ClipboardPaste, FileDown, ListChecks, Moon, Radar, Search, Sun, type LucideIcon } from 'lucide-react';
import { BusyIcon } from '@/components/career/bits';
import { useTheme } from '@/components/career/panel/panel-hooks';
import { TAB_ICONS } from '@/components/shell/tab-icons';
import { DESKTOP_LAYOUT } from '@/lib/shell/desktop';
import { TABS, appHref } from '@/lib/shell/tabs';

type ActionProps = Readonly<{
  onSearch: () => void;
  onPaste: () => void;
  onRunSearch: () => void;
  onQueue: () => void;
  onExport: () => void;
  queueCount: number;
  busy: string | null;
}>;

type Action = {
  id: string;
  /** The accessible name, and the rail's tooltip. */
  label: string;
  /** What the page's labelled button says. */
  short: string;
  Icon: LucideIcon;
  onClick: () => void;
  busy?: boolean;
  badge?: number;
  hint?: string;
};

/** Career's five actions, once, for the rail's icons and the page's labelled buttons. */
function careerActions({ onSearch, onPaste, onRunSearch, onQueue, onExport, queueCount, busy }: ActionProps): Action[] {
  return [
    { id: 'search', label: 'Search', short: 'Search', Icon: Search, onClick: onSearch, hint: '/' },
    { id: 'paste', label: 'Paste a job', short: 'Paste a job', Icon: ClipboardPaste, onClick: onPaste },
    { id: 'run', label: busy === 'search' ? 'Searching your sources…' : 'Run a search now', short: busy === 'search' ? 'Searching…' : 'Run a search', Icon: Radar, onClick: onRunSearch, busy: busy === 'search' },
    { id: 'queue', label: queueCount ? `Open the queue, ${queueCount} waiting` : 'Open the queue', short: 'Queue', Icon: ListChecks, onClick: onQueue, badge: queueCount },
    { id: 'export', label: 'Export the tracker as CSV', short: 'Export CSV', Icon: FileDown, onClick: onExport, busy: busy === 'export' },
  ];
}

function RailButton({ label, hint, onClick, children, badge, busy = false }: Readonly<{
  label: string;
  hint?: string;
  onClick: () => void;
  children: ReactNode;
  badge?: number;
  busy?: boolean;
}>) {
  return (
    <li>
      <button type="button" className="cp-rail-btn" onClick={onClick} aria-label={label} aria-busy={busy || undefined} aria-keyshortcuts={hint === '/' ? '/ Control+K Meta+K' : undefined}>
        {children}
        {badge ? <span className="cp-rail-badge" aria-hidden="true">{badge}</span> : null}
        <span className="cp-tip" aria-hidden="true">{label}{hint && <kbd>{hint}</kbd>}</span>
      </button>
    </li>
  );
}

/**
 * With the desktop layout on, the rail is the app's navigation, the same as
 * /active's: every tab, Career marked as here, named by its tooltip. Career's
 * actions are on the page instead, so the rail is never a mix of the two.
 * career-panel.css hides it below 900px, where the bottom bar keeps the
 * actions and "Back to the app".
 */
function AppNav() {
  return (
    <nav className="cp-rail-apps" aria-label="Orbis">
      <ul>
        {TABS.map(({ id, label }) => {
          const Icon = TAB_ICONS[id];
          const here = id === 'career';
          return (
            <li key={id}>
              <a className="cp-rail-btn" href={here ? '/active/career' : appHref(id)} aria-label={label} aria-current={here ? 'page' : undefined}>
                <Icon size={19} aria-hidden="true" />
                <span className="cp-tip" aria-hidden="true">{label}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * The floating rail on the left (a bar along the bottom on narrow screens).
 * Without the desktop layout it holds Career's actions as icons, each named by
 * its accessible name and a tooltip. With it, it is the app's navigation from
 * 900px up and the actions move onto the page as labelled buttons (PanelActions).
 */
export function PanelRail(props: ActionProps) {
  const { theme, toggle } = useTheme();
  const toLight = theme === 'dark';
  return (
    <aside className={DESKTOP_LAYOUT ? 'cp-rail cp-rail-nav' : 'cp-rail'} aria-label="Quick actions">
      {DESKTOP_LAYOUT && <AppNav />}
      <ul className="cp-rail-tools">
        {careerActions(props).map(({ id, label, hint, Icon, onClick, busy, badge }) => (
          <RailButton key={id} label={label} hint={hint} onClick={onClick} busy={busy} badge={badge}>
            <BusyIcon on={Boolean(busy)} size={18}><Icon size={18} aria-hidden="true" /></BusyIcon>
          </RailButton>
        ))}
      </ul>
      <ul className="cp-rail-tools">
        <RailButton label={toLight ? 'Switch to light appearance' : 'Switch to dark appearance'} onClick={toggle}>
          {toLight ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
        </RailButton>
        <li>
          <a className="cp-rail-btn" href="/active#career" aria-label="Back to the app">
            <ArrowLeft size={18} aria-hidden="true" />
            <span className="cp-tip" aria-hidden="true">Back to the app</span>
          </a>
        </li>
      </ul>
    </aside>
  );
}

/**
 * Career's actions as labelled buttons above the page, for the desktop layout,
 * where the rail is navigation instead. Hidden below 900px (career-panel.css),
 * where the bottom bar has them.
 */
export function PanelActions(props: ActionProps) {
  return (
    <section className="cp-actions" aria-label="Career actions">
      {careerActions(props).map(({ id, label, short, hint, Icon, onClick, busy, badge }) => (
        <button key={id} type="button" className="cp-tool-btn" onClick={onClick} aria-label={label} aria-busy={busy || undefined} aria-keyshortcuts={hint === '/' ? '/ Control+K Meta+K' : undefined}>
          <BusyIcon on={Boolean(busy)} size={16}><Icon size={16} aria-hidden="true" /></BusyIcon>
          {short}
          {badge ? <span className="cp-actions-count" aria-hidden="true">{badge}</span> : null}
          {hint && <kbd aria-hidden="true">{hint}</kbd>}
        </button>
      ))}
    </section>
  );
}
