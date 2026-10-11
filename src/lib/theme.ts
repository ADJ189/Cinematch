// src/lib/theme.ts — compatibility facade. Light/dark/system now lives in
// appearance.ts (the one module that touches `data-theme`); this file only
// keeps the old import surface working.

import { effectiveMode, initAppearance, toggleQuickMode, updatePreferences } from './appearance';

export type Theme = 'dark' | 'light';

export function getTheme(): Theme {
  return effectiveMode();
}

export function setTheme(theme: Theme): void {
  updatePreferences({ mode: theme }, { immediate: true });
}

export function toggleTheme(): Theme {
  return toggleQuickMode();
}

/** Call once at startup, before first paint of app content. */
export function initTheme(): void {
  initAppearance();
}
