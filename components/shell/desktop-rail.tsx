'use client';

import { Settings } from 'lucide-react';
import { OrbisAiMark } from '@/components/brand/orbis-ai-mark';
import { OrbisMark } from '@/components/brand/orbis-mark';
import { TABS, type TabId } from '@/lib/shell/tabs';
import { TAB_ICONS } from '@/components/shell/tab-icons';

/**
 * The desktop's navigation: a macOS sidebar floating at the window's leading
 * edge, each tab an icon and its name. When the window is narrow or Ask Orbis
 * is docked it folds to icons, and the names become tooltips
 * (app/styles/desktop.css). The five tabs that live in this page switch in
 * place; Career leaves for its full panel. Ask Orbis and Settings sit at the
 * foot. Always rendered, and hidden below the breakpoint, where the bottom nav
 * is the navigation instead.
 */
export function DesktopRail({ tab, onTab, onAsk, onSettings }: Readonly<{
  tab: TabId;
  onTab: (tab: TabId) => void;
  onAsk: () => void;
  onSettings: () => void;
}>) {
  return (
    <nav className="dk-rail" aria-label="Orbis">
      <p className="dk-rail-brand" aria-hidden="true"><OrbisMark size={22} /><span>Orbis</span></p>
      <ul>
        {TABS.map(({ id, label }) => {
          const Icon = TAB_ICONS[id];
          // The selected row carries `active` as well as aria-current, as the bottom nav's does: the tests and the motion runtime find it either way.
          const className = tab === id ? 'dk-rail-btn active' : 'dk-rail-btn';
          const body = (
            <>
              <Icon size={18} aria-hidden="true" />
              <span className="dk-rail-label" aria-hidden="true">{label}</span>
            </>
          );
          return (
            <li key={id}>
              {id === 'career'
                ? <a className={className} href="/active/career" aria-label={label} aria-current={tab === id ? 'page' : undefined}>{body}</a>
                : <button type="button" className={className} onClick={() => onTab(id)} aria-label={label} aria-current={tab === id ? 'page' : undefined}>{body}</button>}
            </li>
          );
        })}
      </ul>
      <ul className="dk-rail-foot">
        <li>
          <button type="button" className="dk-rail-btn dk-rail-ask" onClick={onAsk} aria-label="Ask Orbis">
            <OrbisAiMark size={20} />
            <span className="dk-rail-label" aria-hidden="true">Ask Orbis</span>
          </button>
        </li>
        <li>
          <button type="button" className="dk-rail-btn" onClick={onSettings} aria-label="Settings">
            <Settings size={18} aria-hidden="true" />
            <span className="dk-rail-label" aria-hidden="true">Settings</span>
          </button>
        </li>
      </ul>
    </nav>
  );
}
