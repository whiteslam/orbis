'use client';

import { useMemo, useState } from 'react';
import { Briefcase, LayoutGrid, Settings, Sparkles, WalletCards } from 'lucide-react';
import { PaletteDialog } from '@/components/shell/palette-dialog';
import { PAGE_META, PANEL_PAGES } from '@/components/career/panel/panel-data';
import { appPalette, rankPalette, type AppPaletteItem, type PaletteGo } from '@/lib/shell/palette';

const KIND: Record<AppPaletteItem['kind'], { word: string; Icon: typeof LayoutGrid }> = {
  tab: { word: 'Tab', Icon: LayoutGrid },
  view: { word: 'Money', Icon: WalletCards },
  settings: { word: 'Settings', Icon: Settings },
  career: { word: 'Career', Icon: Briefcase },
  action: { word: 'Ask', Icon: Sparkles },
};

const CAREER_PAGES = PANEL_PAGES.map((id) => ({ id, label: PAGE_META[id].label }));

/** The desktop's Ctrl/⌘+K: jump to any tab, Money view, Settings section or Career page. Loaded on first open. */
export function AppPalette({ onGo, onClose }: Readonly<{ onGo: (go: PaletteGo) => void; onClose: () => void }>) {
  const items = useMemo(() => appPalette(CAREER_PAGES), []);
  const [query, setQuery] = useState('');
  const results = useMemo(() => rankPalette(items, query), [items, query]);
  return (
    <PaletteDialog
      label="Search Orbis"
      inputLabel="Search tabs, settings and Career pages"
      placeholder="Jump to a tab, a setting or a Career page"
      query={query}
      onQuery={setQuery}
      results={results}
      describe={(item) => KIND[item.kind]}
      onPick={(item) => onGo(item.go)}
      onClose={onClose}
      empty={<>Nothing matches “{query}”. Try a tab, like Money, or a setting, like Security.</>}
    />
  );
}
