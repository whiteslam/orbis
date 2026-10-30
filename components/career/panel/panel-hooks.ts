'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { pageFromHash, type PanelPage } from '@/components/career/panel/panel-data';

// ─── Hash routes ─────────────────────────────────────────────────────────

function subscribeHash(onChange: () => void) {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

/**
 * The page in the address bar ("#/pipeline"). Links are plain `<a href>`s, so
 * the back and forward buttons and a pasted link all land on the right page.
 */
export function useHashPage(): PanelPage {
  const hash = useSyncExternalStore(subscribeHash, () => window.location.hash, () => '');
  return pageFromHash(hash);
}

/** The `q` in "#/pipeline?q=Razorpay", which the palette uses to open a page already searched. */
export function useHashQuery(): string {
  const hash = useSyncExternalStore(subscribeHash, () => window.location.hash, () => '');
  const at = hash.indexOf('?');
  return at < 0 ? '' : new URLSearchParams(hash.slice(at + 1)).get('q') ?? '';
}

/** The `stage` in "#/pipeline?stage=sent", which Home's stage strip uses to open Applications at one stage. */
export function useHashStage(): string {
  const hash = useSyncExternalStore(subscribeHash, () => window.location.hash, () => '');
  const at = hash.indexOf('?');
  return at < 0 ? '' : new URLSearchParams(hash.slice(at + 1)).get('stage') ?? '';
}

export function goTo(page: PanelPage, query?: string) {
  window.location.hash = query ? `/${page}?q=${encodeURIComponent(query)}` : `/${page}`;
}

// ─── Theme ───────────────────────────────────────────────────────────────

type Theme = 'light' | 'dark';

// The app's own switch (components/theme-toggle.tsx): `data-theme` on <html>,
// remembered under 'orbis-theme', which the root layout reads before paint.
const THEME_KEY = 'orbis-theme';
const themeListeners = new Set<() => void>();

function readTheme(): Theme {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

function subscribeTheme(onChange: () => void) {
  themeListeners.add(onChange);
  return () => {
    themeListeners.delete(onChange);
  };
}

/** The current appearance and a switch that behaves exactly like the app's theme toggle. */
export function useTheme(): { theme: Theme; toggle: () => void } {
  const theme = useSyncExternalStore(subscribeTheme, readTheme, () => 'dark' as Theme);
  const toggle = useCallback(() => {
    const next: Theme = readTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // Private mode or blocked storage: the choice still applies to this page.
    }
    for (const listener of themeListeners) listener();
  }, []);
  return { theme, toggle };
}

// ─── Keyboard ────────────────────────────────────────────────────────────

function typingIn(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/** "/" (outside a text field) and Ctrl/⌘+K open the command palette. */
export function usePaletteShortcut(open: () => void) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const combo = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k';
      const slash = event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey && !typingIn(event.target);
      if (!combo && !slash) return;
      event.preventDefault();
      open();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);
}

// ─── Files ───────────────────────────────────────────────────────────────

/** Hands `text` to the browser as a file download. */
export function downloadText(text: string, fileName: string, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 'orbis-career-2026-10-27.csv'. */
export function datedName(stem: string, extension = 'csv') {
  return `${stem}-${new Date().toISOString().slice(0, 10)}.${extension}`;
}
