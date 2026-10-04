// src/lib/theme.ts — light/dark mode, persisted, defaulting to system preference.

import { safeGet, safeSet } from './storage';

export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'cinematch-theme';

function systemPrefersLight(): boolean {
  try {
    return window.matchMedia('(prefers-color-scheme: light)').matches;
  } catch {
    return false;
  }
}

export function getTheme(): Theme {
  const stored = safeGet(STORAGE_KEY);
  if (stored === 'dark' || stored === 'light') return stored;
  return systemPrefersLight() ? 'light' : 'dark';
}

export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.style.colorScheme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'light' ? '#f7f3ee' : '#0a0714');
}

export function setTheme(theme: Theme): void {
  safeSet(STORAGE_KEY, theme);
  applyTheme(theme);
}

export function toggleTheme(): Theme {
  const next: Theme = getTheme() === 'dark' ? 'light' : 'dark';
  setTheme(next);
  return next;
}

/** Call once at startup, before first paint of app content. */
export function initTheme(): void {
  applyTheme(getTheme());
}
