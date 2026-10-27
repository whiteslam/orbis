'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { LoaderCircle, MoreHorizontal } from 'lucide-react';
import { useDismiss } from '@/components/career/panel/panel-bits';
import type { OwnerMove, Result } from '@/lib/career/view';

const MENU_WIDTH = 230;

type MenuState = { kind: 'closed' } | { kind: 'loading' } | { kind: 'ready'; moves: OwnerMove[] } | { kind: 'failed'; message: string };

/**
 * A card's menu: Open, and every move the server allows from here. It is the
 * keyboard (and touch) way to do anything a drag does.
 */
export function MoveMenu({ title, loadMoves, onMove, onOpen }: Readonly<{
  title: string;
  loadMoves: () => Promise<Result<OwnerMove[]>>;
  onMove: (move: OwnerMove) => void;
  onOpen: () => void;
}>) {
  const [state, setState] = useState<MenuState>({ kind: 'closed' });
  const [place, setPlace] = useState<CSSProperties>({});
  const box = useRef<HTMLDivElement | null>(null);
  const menu = useRef<HTMLDivElement | null>(null);
  const close = useCallback(() => setState({ kind: 'closed' }), []);
  const open = state.kind !== 'closed';
  useDismiss(open, box, close, menu);

  // The menu is fixed to the viewport so a scrolling lane can't clip it; a scroll closes it.
  useEffect(() => {
    if (!open) return;
    const onScroll = (event: Event) => {
      if (event.target instanceof Node && menu.current?.contains(event.target)) return;
      close();
    };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', close);
    };
  }, [open, close]);

  const toggle = () => {
    if (open) {
      close();
      return;
    }
    const rect = box.current?.getBoundingClientRect();
    if (rect) {
      const below = window.innerHeight - rect.bottom > 260;
      setPlace({
        left: Math.max(8, Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8)),
        ...(below ? { top: rect.bottom + 6 } : { bottom: window.innerHeight - rect.top + 6 }),
      });
    }
    setState({ kind: 'loading' });
    void loadMoves().then((result) => {
      setState((current) => {
        if (current.kind === 'closed') return current;
        return result.success ? { kind: 'ready', moves: result.data } : { kind: 'failed', message: result.message };
      });
      // Focus the first item once the list exists, as a menu button should.
      requestAnimationFrame(() => menu.current?.querySelector<HTMLElement>('button')?.focus());
    });
  };

  // Arrows move between items; Tab leaves the menu back at its button (the menu lives at the end of <body>).
  const onMenuKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = [...(menu.current?.querySelectorAll<HTMLElement>('button') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      items[(at + step + items.length) % items.length]?.focus();
    } else if (event.key === 'Tab') {
      event.preventDefault();
      close();
      box.current?.querySelector<HTMLElement>('button')?.focus();
    }
  };

  const pick = (action: () => void) => {
    close();
    action();
  };

  return (
    <div className="cp-menu-wrap" ref={box}>
      <button type="button" className="cp-menu-btn" aria-expanded={open} aria-haspopup="true" onClick={toggle} aria-label={`Actions for ${title}`}>
        <MoreHorizontal size={16} aria-hidden="true" />
      </button>
      {open && createPortal((
        // In a portal on <body>: a lane's scroll box and its glass would clip or re-anchor a fixed menu.
        <div className="cp-menu" style={place} ref={menu} onKeyDown={onMenuKey}>
          <button type="button" onClick={() => pick(onOpen)}>Open details</button>
          {state.kind === 'loading' && <output className="cp-menu-note"><LoaderCircle className="cr-spin" size={13} aria-hidden="true" />Checking what you can change…</output>}
          {state.kind === 'failed' && <output className="cp-menu-note bad">Moves aren’t available: {state.message}</output>}
          {state.kind === 'ready' && state.moves.length === 0 && <output className="cp-menu-note">Nothing to change by hand from here. Gmail moves it on as replies come in.</output>}
          {state.kind === 'ready' && state.moves.length > 0 && (
            <>
              <p className="cp-menu-label">Move to</p>
              {state.moves.map((move) => (
                <button key={move.to} type="button" className={move.to === 'withdrawn' ? 'alert' : undefined} onClick={() => pick(() => onMove(move))}>{move.label}</button>
              ))}
            </>
          )}
        </div>
      ), document.body)}
    </div>
  );
}
