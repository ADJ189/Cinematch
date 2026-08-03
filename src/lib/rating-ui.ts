// src/lib/rating-ui.ts
//
// The watchlist toggle button and 5-star rating row are identical between
// the quiz-results screen and the search screen's cards — both operate on
// the same ScoredItem shape and the same profile.ts functions. Shared
// here instead of two copies drifting apart.

import { el } from './dom';
import { ICON } from './icons';
import { isInWatchlist, toggleWatchlist } from './profile';
import type { CatalogItem, RatingValue } from './types';

export function buildWatchlistButton(item: CatalogItem): HTMLElement {
  const btn = el('button', {
    class: `watchlist-btn${isInWatchlist(item.id) ? ' active' : ''}`,
    'aria-label': isInWatchlist(item.id) ? 'Remove from watchlist' : 'Save to watchlist',
    onclick: (e: Event) => {
      e.stopPropagation();
      const nowSaved = toggleWatchlist(item);
      btn.classList.toggle('active', nowSaved);
      btn.innerHTML = nowSaved ? ICON.bookmarkFilled : ICON.bookmark;
    },
  });
  btn.innerHTML = isInWatchlist(item.id) ? ICON.bookmarkFilled : ICON.bookmark;
  return btn;
}

export function buildStarRow(id: number, current: RatingValue | undefined, onRate: (v: RatingValue) => void): HTMLElement {
  const stars = ([1, 2, 3, 4, 5] as RatingValue[]).map((n) =>
    el(
      'button',
      {
        class: `star${current !== undefined && n <= current ? ' filled' : ''}`,
        'aria-label': `Rate ${n} star${n > 1 ? 's' : ''}`,
        onclick: (e: Event) => {
          e.stopPropagation();
          onRate(n);
        },
      },
      ['★']
    )
  );
  return el('div', { class: 'star-row star-row-sm', 'data-item': id }, stars);
}
