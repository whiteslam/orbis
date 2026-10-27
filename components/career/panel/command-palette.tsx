'use client';

import { useMemo, useState } from 'react';
import { Briefcase, Building2, LayoutGrid, Search, Send } from 'lucide-react';
import { PaletteDialog } from '@/components/shell/palette-dialog';
import { searchPalette, type PaletteItem } from '@/components/career/panel/panel-data';

const KIND: Record<PaletteItem['kind'], { word: string; Icon: typeof Search }> = {
  page: { word: 'Page', Icon: LayoutGrid },
  application: { word: 'Application', Icon: Send },
  job: { word: 'Job', Icon: Briefcase },
  company: { word: 'Company', Icon: Building2 },
};

/**
 * Search over what the panel has loaded: pages, applications, jobs and
 * companies. The dialog itself is the app's (components/shell/palette-dialog.tsx).
 */
export function CommandPalette({ items, onPick, onClose }: Readonly<{ items: readonly PaletteItem[]; onPick: (item: PaletteItem) => void; onClose: () => void }>) {
  const [query, setQuery] = useState('');
  const results = useMemo(() => searchPalette(items, query), [items, query]);
  return (
    <PaletteDialog
      label="Search Career"
      inputLabel="Search jobs, companies and applications"
      placeholder="Search jobs, companies, applications or pages"
      query={query}
      onQuery={setQuery}
      results={results}
      describe={(item) => KIND[item.kind]}
      onPick={onPick}
      onClose={onClose}
      empty={<>Nothing loaded matches “{query}”. Try a company or a job title.</>}
    />
  );
}
