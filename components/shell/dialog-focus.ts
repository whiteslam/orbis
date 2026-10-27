'use client';

import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Tab and Shift+Tab wrap around inside `root` instead of leaving it. Call from a keydown handler. */
export function keepTabInside(root: HTMLElement, event: KeyboardEvent) {
  if (event.key !== 'Tab') return;
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
}

/**
 * A dialog's focus: in on open (the element marked data-autofocus, else the
 * first control), Tab kept inside, Escape closes, and back to the opener on close.
 * Shared by the Career panel's dialogs and the app's command palette.
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
      if (root) keepTabInside(root, event);
    };
    root?.addEventListener('keydown', onKey);
    return () => {
      root?.removeEventListener('keydown', onKey);
      opener?.focus({ preventScroll: true });
    };
  }, [ref]);
}
