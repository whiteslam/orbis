'use client';

import type { ReactNode } from 'react';
import { ArrowLeft, ClipboardPaste, FileDown, ListChecks, Moon, Radar, Search, Sun } from 'lucide-react';
import { BusyIcon } from '@/components/career/bits';
import { useTheme } from '@/components/career/panel/panel-hooks';
import { TAB_ICONS } from '@/components/shell/tab-icons';
import { DESKTOP_LAYOUT } from '@/lib/shell/desktop';
import { TABS, appHref } from '@/lib/shell/tabs';

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
 * The app's other tabs, so the panel's rail matches /active's on a laptop:
 * one rail, and a tab is a click away rather than "back" and then a click.
 * Only with the desktop layout on; career-panel.css hides it below 900px,
 * where "Back to the app" stays the way out.
 */
function AppLinks() {
  return (
    <ul className="cp-rail-apps" aria-label="Orbis">
      {TABS.filter(({ id }) => id !== 'career').map(({ id, label }) => {
        const Icon = TAB_ICONS[id];
        return (
          <li key={id}>
            <a className="cp-rail-btn" href={appHref(id)} aria-label={label}>
              <Icon size={18} aria-hidden="true" />
              <span className="cp-tip" aria-hidden="true">{label}</span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The floating quick-action rail on the left (a bar along the bottom on narrow
 * screens). Every button has its name as its accessible name and as a tooltip.
 */
export function PanelRail({ onSearch, onPaste, onRunSearch, onQueue, onExport, queueCount, busy }: Readonly<{
  onSearch: () => void;
  onPaste: () => void;
  onRunSearch: () => void;
  onQueue: () => void;
  onExport: () => void;
  queueCount: number;
  busy: string | null;
}>) {
  const { theme, toggle } = useTheme();
  const toLight = theme === 'dark';
  return (
    <aside className="cp-rail" aria-label="Quick actions">
      {DESKTOP_LAYOUT && <AppLinks />}
      <ul>
        <RailButton label="Search" hint="/" onClick={onSearch}><Search size={18} aria-hidden="true" /></RailButton>
        <RailButton label="Paste a job" onClick={onPaste}><ClipboardPaste size={18} aria-hidden="true" /></RailButton>
        <RailButton label={busy === 'search' ? 'Searching your sources…' : 'Run a search now'} onClick={onRunSearch} busy={busy === 'search'}>
          <BusyIcon on={busy === 'search'} size={18}><Radar size={18} aria-hidden="true" /></BusyIcon>
        </RailButton>
        <RailButton label={queueCount ? `Open the queue, ${queueCount} waiting` : 'Open the queue'} onClick={onQueue} badge={queueCount}>
          <ListChecks size={18} aria-hidden="true" />
        </RailButton>
        <RailButton label="Export the tracker as CSV" onClick={onExport} busy={busy === 'export'}>
          <BusyIcon on={busy === 'export'} size={18}><FileDown size={18} aria-hidden="true" /></BusyIcon>
        </RailButton>
      </ul>
      <ul>
        <RailButton label={toLight ? 'Switch to light appearance' : 'Switch to dark appearance'} onClick={toggle}>
          {toLight ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
        </RailButton>
        <li className="cp-rail-back">
          <a className="cp-rail-btn" href="/active#career" aria-label="Back to the app">
            <ArrowLeft size={18} aria-hidden="true" />
            <span className="cp-tip" aria-hidden="true">Back to the app</span>
          </a>
        </li>
      </ul>
    </aside>
  );
}
