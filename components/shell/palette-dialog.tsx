'use client';

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Search, type LucideIcon } from 'lucide-react';
import { useDialogFocus } from '@/components/shell/dialog-focus';

/**
 * A command palette: a combobox over a listbox, in a veil near the top of the
 * window. Arrows move, Enter opens, Escape or a press outside closes; focus
 * goes back to whatever opened it. The caller owns the query and the results,
 * so the Career panel and the app each search their own things with it.
 */
export function PaletteDialog<T extends { id: string; label: string; detail: string }>({ label, inputLabel, placeholder, query, onQuery, results, describe, onPick, onClose, empty }: Readonly<{
  /** The dialog's name. */
  label: string;
  inputLabel: string;
  placeholder: string;
  query: string;
  onQuery: (query: string) => void;
  results: readonly T[];
  /** The word on the right and the icon on the left of a result. */
  describe: (item: T) => { word: string; Icon: LucideIcon };
  onPick: (item: T) => void;
  onClose: () => void;
  /** What to say when nothing matches. */
  empty: ReactNode;
}>) {
  const listId = useId();
  const box = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState(0);
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
      <div className="cp-palette" ref={box} role="dialog" aria-modal="true" aria-label={label}>
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
            aria-label={inputLabel}
            placeholder={placeholder}
            value={query}
            onChange={(event) => { onQuery(event.currentTarget.value); setActive(0); }}
            onKeyDown={onKey}
          />
          <kbd>Esc</kbd>
        </div>
        <ul className="cp-palette-list" id={listId} role="listbox" aria-label="Results">
          {results.map((item, index) => {
            const { word, Icon } = describe(item);
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
        {results.length === 0 && <p className="cp-palette-none">{empty}</p>}
        <p className="cp-palette-foot" aria-hidden="true"><kbd>↑</kbd><kbd>↓</kbd> to move <kbd>Enter</kbd> to open</p>
      </div>
    </div>
  );
}
