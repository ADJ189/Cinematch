// src/lib/header.ts — persistent top bar across all screens: logo, GitHub
// link, and the dark/light toggle. Rendered once by main.ts, outside the
// screen-switching cycle, so it never flickers or re-mounts on navigation.

import { el } from './dom';
import { getTheme, toggleTheme } from './theme';

const GITHUB_URL = 'https://github.com/ADJ189/Cinematch';

export function renderHeader(): HTMLElement {
  const themeBtn = el(
    'button',
    { class: 'theme-toggle', 'aria-label': 'Toggle light/dark theme', onclick: onToggle },
    [themeIcon()]
  );

  const header = el('header', { class: 'app-header' }, [
    el('div', { class: 'app-header-inner' }, [
      el('a', { class: 'app-brand', href: '/', 'aria-label': 'CineMatch home' }, [
        el('img', { src: '/logo.svg', alt: '', width: '22', height: '22' }),
        el('span', {}, ['CineMatch']),
      ]),
      el('div', { class: 'app-header-actions' }, [
        themeBtn,
        el(
          'a',
          {
            class: 'app-header-link',
            href: GITHUB_URL,
            target: '_blank',
            rel: 'noopener',
            'aria-label': 'View source on GitHub',
          },
          [githubIcon(), el('span', { class: 'app-header-link-label' }, ['GitHub'])]
        ),
      ]),
    ]),
  ]);

  function onToggle() {
    toggleTheme();
    themeBtn.replaceChildren(themeIcon());
  }

  return header;
}

function themeIcon(): HTMLElement {
  return getTheme() === 'light' ? el('span', {}, ['🌙']) : el('span', {}, ['☀️']);
}

function githubIcon(): HTMLElement {
  const wrap = el('span', { class: 'gh-icon', 'aria-hidden': 'true' }, []);
  wrap.innerHTML =
    '<svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/></svg>';
  return wrap;
}
