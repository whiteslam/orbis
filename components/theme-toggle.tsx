'use client';

import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';

type Theme = 'light' | 'dark';

/** Reads whatever the pre-paint script in the layout already resolved, so the
 *  button never disagrees with the page it sits on. */
function currentTheme(): Theme {
  if (typeof document === 'undefined') return 'light';
  const set = document.documentElement.dataset.theme;
  if (set === 'light' || set === 'dark') return set;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function ThemeToggle() {
  // Starts undefined so the server and the first client render agree; the
  // real value arrives in the effect below.
  const [theme, setTheme] = useState<Theme | undefined>(undefined);

  useEffect(() => {
    setTheme(currentTheme());
  }, []);

  // While the user has not chosen, keep following the system.
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      if (!localStorage.getItem('orbis-theme')) setTheme(media.matches ? 'dark' : 'light');
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  const toggle = () => {
    const next: Theme = currentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('orbis-theme', next);
    } catch {
      // Private mode or blocked storage: the choice still applies to this page.
    }
    setTheme(next);
  };

  const isDark = theme === 'dark';

  return (
    <button
      className="icon-btn"
      type="button"
      onClick={toggle}
      aria-pressed={isDark}
      aria-label={isDark ? 'Switch to light appearance' : 'Switch to dark appearance'}
      title={isDark ? 'Light appearance' : 'Dark appearance'}
    >
      {/* Before the effect runs, theme is undefined and neither icon is right;
          render the moon and let the effect correct it in the same frame. */}
      {isDark ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}
