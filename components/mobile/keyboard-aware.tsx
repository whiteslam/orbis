'use client';

import { useEffect } from 'react';

// visualViewport shrinks by at least this much when an on-screen keyboard opens (browser toolbars move far less).
const KEYBOARD_MIN_PX = 140;

function isTextField(element: Element | null): element is HTMLElement {
  if (!element) return false;
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) return true;
  if (element instanceof HTMLInputElement) return !['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'file', 'color', 'image', 'hidden'].includes(element.type);
  return element instanceof HTMLElement && element.isContentEditable;
}

// Marks <html class="keyboard-open"> while the on-screen keyboard is up (CSS hides the bottom nav)
// and keeps the focused field visible above the keyboard.
export function KeyboardAware() {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const root = document.documentElement;
    let baseline = Math.max(window.innerHeight, viewport.height);
    let revealTimer = 0;

    const update = () => {
      // Grow the baseline with rotation or collapsing toolbars; never let the keyboard lower it.
      if (!isTextField(document.activeElement)) baseline = Math.max(window.innerHeight, viewport.height);
      const open = isTextField(document.activeElement) && baseline - viewport.height > KEYBOARD_MIN_PX;
      root.classList.toggle('keyboard-open', open);
    };

    const reveal = (event: FocusEvent) => {
      if (!isTextField(event.target as Element)) return;
      window.clearTimeout(revealTimer);
      // Wait for the keyboard animation, then bring the field into the middle of what is still visible.
      revealTimer = window.setTimeout(() => {
        update();
        (event.target as HTMLElement).scrollIntoView({ block: 'center', behavior: 'smooth' });
      }, 320);
    };

    const onFocusOut = () => window.setTimeout(update, 80);
    const onRotate = () => {
      baseline = 0;
      window.setTimeout(update, 250);
    };

    viewport.addEventListener('resize', update);
    window.addEventListener('focusin', reveal);
    window.addEventListener('focusout', onFocusOut);
    window.addEventListener('orientationchange', onRotate);
    update();

    return () => {
      viewport.removeEventListener('resize', update);
      window.removeEventListener('focusin', reveal);
      window.removeEventListener('focusout', onFocusOut);
      window.removeEventListener('orientationchange', onRotate);
      window.clearTimeout(revealTimer);
      root.classList.remove('keyboard-open');
    };
  }, []);

  return null;
}
