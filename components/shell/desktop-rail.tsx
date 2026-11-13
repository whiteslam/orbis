'use client';

import { Settings } from 'lucide-react';
import { OrbisAiMark } from '@/components/brand/orbis-ai-mark';
import { TABS, type TabId } from '@/lib/shell/tabs';
import { TAB_ICONS } from '@/components/shell/tab-icons';

/**
 * The desktop's navigation: a floating pill on the left, styled like the
 * Career panel's rail (.cp-rail). Only the tabs the person has on are listed
 * (`tabs`, from lib/shell/modules.ts). Those that live in this page switch in
 * place; Career leaves for its full panel. Ask Orbis and Settings sit at
 * the foot. Always rendered, and hidden by app/styles/desktop.css below the
 * breakpoint, where the bottom nav is the navigation instead.
 */
export function DesktopRail({ tabs, tab, onTab, onAsk, onSettings }: Readonly<{
  tabs: TabId[];
  tab: TabId;
  onTab: (tab: TabId) => void;
  onAsk: () => void;
  onSettings: () => void;
}>) {
  return (
    <nav className="cp-rail dk-rail" aria-label="Orbis">
      <ul>
        {TABS.filter(({ id }) => tabs.includes(id)).map(({ id, label }) => {
          const Icon = TAB_ICONS[id];
          const body = (
            <>
              <Icon size={19} aria-hidden="true" />
              <span className="cp-tip" aria-hidden="true">{label}</span>
            </>
          );
          return (
            <li key={id}>
              {id === 'career'
                ? <a className="cp-rail-btn" href="/active/career" aria-label={label} aria-current={tab === id ? 'page' : undefined}>{body}</a>
                : <button type="button" className="cp-rail-btn" onClick={() => onTab(id)} aria-label={label} aria-current={tab === id ? 'page' : undefined}>{body}</button>}
            </li>
          );
        })}
      </ul>
      <ul>
        <li>
          <button type="button" className="cp-rail-btn dk-rail-ask" onClick={onAsk} aria-label="Ask Orbis">
            <OrbisAiMark size={24} />
            <span className="cp-tip" aria-hidden="true">Ask Orbis</span>
          </button>
        </li>
        <li>
          <button type="button" className="cp-rail-btn" onClick={onSettings} aria-label="Settings">
            <Settings size={19} aria-hidden="true" />
            <span className="cp-tip" aria-hidden="true">Settings</span>
          </button>
        </li>
      </ul>
    </nav>
  );
}
