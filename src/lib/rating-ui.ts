// src/lib/rating-ui.ts
//
// The watchlist toggle and 5-star rating row used by every screen that
// shows a title card (results, search, rating grid). One implementation,
// keyed on the composite media key so a movie and a show that share a
// TMDB number never share state.

import { el } from './dom';
import { ICON } from './icons';
import { keyOf, keySelector } from './media-key';
import { isInWatchlist, toggleWatchlist } from './profile';
import { showToast } from './toast';
import type { CatalogItem, RatingValue } from './types';

export function buildWatchlistButton(item: CatalogItem): HTMLElement {
  const paint = (btn: HTMLElement, saved: boolean) => {
    btn.classList.toggle('active', saved);
    btn.setAttribute('aria-pressed', saved ? 'true' : 'false');
    btn.setAttribute('aria-label', saved ? `Remove ${item.title} from watchlist` : `Save ${item.title} to watchlist`);
    btn.innerHTML = saved ? ICON.bookmarkFilled : ICON.bookmark;
  };
  const btn = el('button', {
    class: 'watchlist-btn',
    type: 'button',
    onclick: (e: Event) => {
      e.stopPropagation();
      const nowSaved = toggleWatchlist(item);
      paint(btn, nowSaved);
      btn.classList.remove('pop');
      void btn.offsetWidth; // restart the confirmation animation
      btn.classList.add('pop');
      showToast(nowSaved ? `Saved \u201c${item.title}\u201d to your watchlist` : `Removed \u201c${item.title}\u201d from your watchlist`);
    },
  });
  paint(btn, isInWatchlist(item));
  return btn;
}

/** `ref` supplies the media key; the row repaints from `paintStars`. */
export function buildStarRow(
  ref: { id: number; tmdbType: 'movie' | 'tv' },
  current: RatingValue | undefined,
  onRate: (v: RatingValue) => void
): HTMLElement {
  const key = keyOf(ref);
  const stars = ([1, 2, 3, 4, 5] as RatingValue[]).map((n) =>
    el(
      'button',
      {
        class: `star${current !== undefined && n <= current ? ' filled' : ''}`,
        type: 'button',
        'aria-label': `Rate ${n} star${n > 1 ? 's' : ''}`,
        'aria-pressed': current === n ? 'true' : 'false',
        onclick: (e: Event) => {
          e.stopPropagation();
          onRate(n);
        },
      },
      ['\u2605']
    )
  );
  return el('div', { class: 'star-row star-row-sm', role: 'group', 'aria-label': 'Your rating', 'data-item': key }, stars);
}

/** Repaints every star row for a title inside `scope`. */
export function paintStars(scope: ParentNode, key: string, value: RatingValue): void {
  scope.querySelectorAll<HTMLElement>(keySelector(key)).forEach((row) => {
    row.querySelectorAll<HTMLButtonElement>('.star').forEach((s, i) => {
      s.classList.toggle('filled', i < value);
      s.setAttribute('aria-pressed', i === value - 1 ? 'true' : 'false');
    });
  });
}
