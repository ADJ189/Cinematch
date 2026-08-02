// src/lib/header.ts — persistent top bar across all screens: logo, GitHub
// link, dark/light toggle, and the local profile popover (identity,
// stats, watchlist, reset). Rendered once by main.ts, outside the
// screen-switching cycle, so it never flickers or re-mounts on
// navigation — which also means the profile button stays put and the
// watchlist stays reachable no matter which screen you're on.

import { buildPosterImage, el } from './dom';
import { ICON } from './icons';
import { getStats, getProfile, removeFromWatchlist, resetProfile, setDisplayName, isPersistenceAvailable } from './profile';
import { posterUrl, tmdbDetailsUrl } from './tmdb';
import { getTheme, toggleTheme } from './theme';

const GITHUB_URL = 'https://github.com/ADJ189/Cinematch';

export function renderHeader(): HTMLElement {
  const themeBtn = el(
    'button',
    { class: 'theme-toggle', 'aria-label': 'Toggle light/dark theme', onclick: onToggle },
    [themeIcon()]
  );

  const profileBtn = el('button', { class: 'profile-btn', 'aria-label': 'Your profile & watchlist' }, [avatarInitial()]);
  const popover = buildProfilePopover();
  let open = false;

  profileBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    open = !open;
    popover.classList.toggle('open', open);
    if (open) refreshPopover();
  });
  document.addEventListener('click', (e) => {
    if (open && !popover.contains(e.target as Node) && e.target !== profileBtn) {
      open = false;
      popover.classList.remove('open');
    }
  });

  const header = el('header', { class: 'app-header' }, [
    el('div', { class: 'app-header-inner' }, [
      el('a', { class: 'app-brand', href: '/', 'aria-label': 'CineMatch home' }, [
        el('img', { src: '/logo.svg', alt: '', width: '22', height: '22' }),
        el('span', {}, ['CineMatch']),
      ]),
      el('div', { class: 'app-header-actions' }, [
        themeBtn,
        el('div', { class: 'profile-wrap' }, [profileBtn, popover]),
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

  function avatarInitial(): HTMLElement {
    const p = getProfile();
    const avatar = el('span', { class: 'avatar-circle', style: `background:${p.avatarColor}` }, [
      p.displayName.charAt(0).toUpperCase(),
    ]);
    return avatar;
  }

  function refreshPopover() {
    popover.replaceChildren(...buildPopoverContent());
  }

  function buildProfilePopover(): HTMLElement {
    const pop = el('div', { class: 'profile-popover' }, buildPopoverContent());
    return pop;
  }

  function buildPopoverContent(): HTMLElement[] {
    const p = getProfile();
    const stats = getStats();

    const nameInput = el('input', {
      class: 'profile-name-input',
      value: p.displayName,
      maxlength: '40',
      'aria-label': 'Your display name',
    }) as HTMLInputElement;
    nameInput.addEventListener('change', () => {
      setDisplayName(nameInput.value);
      profileBtn.replaceChildren(avatarInitial());
    });

    const persistenceNote = isPersistenceAvailable()
      ? 'Saved on this device only — no account, no server, nothing syncs elsewhere.'
      : 'This browser is blocking local storage (private mode?) — ratings and your watchlist won\u2019t survive closing the tab this session.';

    const watchlistItems = p.watchlist.slice(0, 8).map((w) => {
      const removeBtn = el('button', {
        class: 'watchlist-row-remove',
        'aria-label': `Remove ${w.title} from watchlist`,
        onclick: (e: Event) => {
          e.preventDefault();
          e.stopPropagation();
          removeFromWatchlist(w.id);
          refreshPopover();
        },
      });
      removeBtn.innerHTML = ICON.close;
      return el('a', { class: 'watchlist-row', href: tmdbDetailsUrl(w.id, w.tmdbType), target: '_blank', rel: 'noopener' }, [
        buildPosterImage({ src: posterUrl(w.posterPath, 'sm'), alt: '', fallbackText: w.title.slice(0, 1) }),
        el('span', { class: 'watchlist-row-title' }, [`${w.title} (${w.year})`]),
        removeBtn,
      ]);
    });

    return [
      el('div', { class: 'profile-popover-header' }, [
        el('span', { class: 'avatar-circle avatar-lg', style: `background:${p.avatarColor}` }, [
          p.displayName.charAt(0).toUpperCase(),
        ]),
        nameInput,
      ]),
      el('p', { class: 'profile-stats' }, [
        `${stats.ratedCount} title${stats.ratedCount === 1 ? '' : 's'} rated · ${stats.watchlistCount} saved`,
      ]),
      el('p', { class: 'profile-note' }, [persistenceNote]),
      el('div', { class: 'profile-divider' }),
      el('p', { class: 'profile-section-label' }, ['Watchlist']),
      watchlistItems.length > 0
        ? el('div', { class: 'watchlist-list' }, watchlistItems)
        : el('p', { class: 'profile-empty' }, ['Nothing saved yet — tap the bookmark on any result to add it.']),
      el('div', { class: 'profile-divider' }),
      el(
        'button',
        {
          class: 'btn-text-danger',
          onclick: () => {
            if (!confirm('Reset your local profile? This clears your rating history and watchlist on this device — it can\u2019t be undone.')) return;
            resetProfile();
            profileBtn.replaceChildren(avatarInitial());
            refreshPopover();
          },
        },
        ['Reset my data']
      ),
    ];
  }

  return header;
}

function themeIcon(): HTMLElement {
  const span = el('span', { class: 'icon-inline', style: 'width:18px;height:18px' });
  span.innerHTML = getTheme() === 'light' ? ICON.moon : ICON.sun;
  return span;
}

function githubIcon(): HTMLElement {
  const wrap = el('span', { class: 'gh-icon', 'aria-hidden': 'true' }, []);
  wrap.innerHTML =
    '<svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/></svg>';
  return wrap;
}
