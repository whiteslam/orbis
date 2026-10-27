'use client';

import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Briefcase, Building2, LayoutGrid, Search, Send } from 'lucide-react';
import { useDialogFocus } from '@/components/career/panel/panel-bits';
import { searchPalette, type PaletteItem } from '@/components/career/panel/panel-data';

const KIND: Record<PaletteItem['kind'], { word: string; Icon: typeof Search }> = {
  page: { word: 'Page', Icon: LayoutGrid },
  application: { word: 'Application', Icon: Send },
  job: { word: 'Job', Icon: Briefcase },
  company: { word: 'Company', Icon: Building2 },
};

/**
 * Search over what the panel has loaded: pages, applications, jobs and
 * companies. A combobox with a listbox: arrows move, Enter opens, Escape closes.
 */
export function CommandPalette({ items, onPick, onClose }: Readonly<{ items: readonly PaletteItem[]; onPick: (item: PaletteItem) => void; onClose: () => void }>) {
  const listId = useId();
  const box = useRef<HTMLDivElement | null>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const results = useMemo(() => searchPalette(items, query), [items, query]);
  const current = Math.min(active, Math.max(0, results.length - 1));
  useDialogFocus(box, onClose);

  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!results.length) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((current + step + results.length) % results.length);
    } else if (event.key === 'Enter' && results[current]) {
      event.preventDefault();
      onPick(results[current]);
    }
  };

  return (
    <div className="cp-veil cp-veil-top" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="cp-palette" ref={box} role="dialog" aria-modal="true" aria-label="Search Career">
        <div className="cp-palette-field">
          <Search size={18} aria-hidden="true" />
          <input
            data-autofocus
            type="text"
            role="combobox"
            aria-expanded={results.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={results[current] ? `${listId}-${current}` : undefined}
            aria-label="Search jobs, companies and applications"
            placeholder="Search jobs, companies, applications or pages"
            value={query}
            onChange={(event) => { setQuery(event.currentTarget.value); setActive(0); }}
            onKeyDown={onKey}
          />
          <kbd>Esc</kbd>
        </div>
        <ul className="cp-palette-list" id={listId} role="listbox" aria-label="Results">
          {results.map((item, index) => {
            const { word, Icon } = KIND[item.kind];
            return (
              // The input owns the keyboard (aria-activedescendant); a click picks too.
              <li
                key={item.id}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === current}
                className={index === current ? 'on' : undefined}
                onPointerMove={() => setActive(index)}
                onClick={() => onPick(item)}
              >
                <span className="cp-palette-icon" aria-hidden="true"><Icon size={15} /></span>
                <span className="cp-palette-text"><b>{item.label}</b><small>{item.detail}</small></span>
                <span className="cp-palette-kind">{word}</span>
              </li>
            );
          })}
        </ul>
        {results.length === 0 && <p className="cp-palette-none">Nothing loaded matches “{query}”. Try a company or a job title.</p>}
        <p className="cp-palette-foot" aria-hidden="true"><kbd>↑</kbd><kbd>↓</kbd> to move <kbd>Enter</kbd> to open</p>
      </div>
    </div>
  );
}
