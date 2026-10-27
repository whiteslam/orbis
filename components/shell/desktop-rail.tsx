'use client';

import { Settings, Sparkles } from 'lucide-react';
import { TABS, type TabId } from '@/lib/shell/tabs';
import { TAB_ICONS } from '@/components/shell/tab-icons';

/**
 * The desktop's navigation: a floating pill on the left, styled like the
 * Career panel's rail (.cp-rail), with every item's name under its icon:
 * icons alone were too hard to tell apart. The five tabs that live in this
 * page switch in place; Career leaves for its full panel. Ask Orbis and Settings sit at
 * the foot. Always rendered, and hidden by app/styles/desktop.css below the
 * breakpoint, where the bottom nav is the navigation instead.
 */
export function DesktopRail({ tab, onTab, onAsk, onSettings }: Readonly<{
  tab: TabId;
  onTab: (tab: TabId) => void;
  onAsk: () => void;
  onSettings: () => void;
}>) {
  return (
    <nav className="cp-rail cp-rail-labelled dk-rail" aria-label="Orbis">
      <ul>
        {TABS.map(({ id, label }) => {
          const Icon = TAB_ICONS[id];
          const body = (
            <>
              <Icon size={19} aria-hidden="true" />
              <span className="cp-rail-label">{label}</span>
            </>
          );
          return (
            <li key={id}>
              {id === 'career'
                ? <a className="cp-rail-btn" href="/active/career" aria-current={tab === id ? 'page' : undefined}>{body}</a>
                : <button type="button" className="cp-rail-btn" onClick={() => onTab(id)} aria-current={tab === id ? 'page' : undefined}>{body}</button>}
            </li>
          );
        })}
      </ul>
      <ul>
        <li>
          <button type="button" className="cp-rail-btn dk-rail-ask" onClick={onAsk} aria-label="Ask Orbis">
            <Sparkles size={19} aria-hidden="true" />
            <span className="cp-rail-label" aria-hidden="true">Ask</span>
          </button>
        </li>
        <li>
          <button type="button" className="cp-rail-btn" onClick={onSettings}>
            <Settings size={19} aria-hidden="true" />
            <span className="cp-rail-label">Settings</span>
          </button>
        </li>
      </ul>
    </nav>
  );
}
