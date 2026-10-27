'use client';

import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react';

/** A bento card: a real heading, an optional aside on the right (a toggle, a link), and its body. */
export function PanelCard({ title, aside, children, className, as = 'section' }: Readonly<{
  title: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  as?: 'section' | 'article';
}>) {
  const id = useId();
  const Tag = as;
  return (
    <Tag className={`cp-card-box${className ? ` ${className}` : ''}`} aria-labelledby={id}>
      <div className="cp-card-head">
        <h2 id={id}>{title}</h2>
        {aside && <div className="cp-card-aside">{aside}</div>}
      </div>
      {children}
    </Tag>
  );
}

/** A single choice among a few, as the house's small segmented control. */
export function MiniSwitch<T extends string>({ label, value, options, onChange }: Readonly<{
  label: string;
  value: T;
  options: ReadonlyArray<readonly [T, string]>;
  onChange: (value: T) => void;
}>) {
  return (
    <div className="so-mini cp-mini" role="radiogroup" aria-label={label}>
      {options.map(([id, text]) => (
        <button key={id} type="button" role="radio" aria-checked={value === id} onClick={() => onChange(id)}>{text}</button>
      ))}
    </div>
  );
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A dialog's focus: in on open (the element marked data-autofocus, else the
 * first control), Tab kept inside, Escape closes, and back to the opener on close.
 */
export function useDialogFocus(ref: RefObject<HTMLElement | null>, onClose: () => void) {
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = ref.current;
    const first = root?.querySelector<HTMLElement>('[data-autofocus]') ?? root?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close.current();
        return;
      }
      if (event.key !== 'Tab' || !root) return;
      const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((item) => item.offsetParent !== null);
      if (!items.length) return;
      const [head, tail] = [items[0], items.at(-1)];
      if (event.shiftKey && document.activeElement === head) {
        event.preventDefault();
        tail?.focus();
      } else if (!event.shiftKey && document.activeElement === tail) {
        event.preventDefault();
        head.focus();
      }
    };
    root?.addEventListener('keydown', onKey);
    return () => {
      root?.removeEventListener('keydown', onKey);
      opener?.focus({ preventScroll: true });
    };
  }, [ref]);
}

/**
 * A popover's dismissal: Escape or a press outside closes it. Focus goes back
 * to its button. `inside` lists extra parts that count as inside (a menu in a portal).
 */
export function useDismiss(open: boolean, ref: RefObject<HTMLElement | null>, onClose: () => void, inside?: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (inside?.current?.contains(event.target)) return;
      if (ref.current && !ref.current.contains(event.target)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      onClose();
      ref.current?.querySelector<HTMLElement>('[aria-expanded]')?.focus();
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, ref, onClose, inside]);
}

/** A big empty or problem state inside a page: what happened and what to do. */
export function PanelEmpty({ title, children, action }: Readonly<{ title: string; children?: ReactNode; action?: ReactNode }>) {
  return (
    <section className="cp-empty">
      <h2>{title}</h2>
      {children && <p>{children}</p>}
      {action && <div className="cp-empty-act">{action}</div>}
    </section>
  );
}
