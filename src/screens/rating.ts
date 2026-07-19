import { RATING_SEEDS } from '../data/rating-seeds';
import { el, mount } from '../lib/dom';
import { parseLetterboxdCsv } from '../lib/letterboxd';
import { store } from '../lib/store';
import { posterUrl, searchTitle } from '../lib/tmdb';
import type { RatingValue } from '../lib/types';

const MIN_RATINGS_TO_CONTINUE = 3;

export function renderRating(root: HTMLElement): () => void {
  const cards = new Map<number, HTMLElement>();

  const grid = el('div', { class: 'rating-grid' });
  const continueBtn = el(
    'button',
    { class: 'btn btn-primary', onclick: onContinue, disabled: true },
    ['Get my recommendations →']
  );
  const countLabel = el('span', { class: 'rating-count' }, ['0 rated']);

  const importInput = el('input', {
    type: 'file',
    accept: '.csv',
    class: 'visually-hidden',
    onchange: onImportFile,
  }) as HTMLInputElement;

  const screen = el('div', { class: 'screen rating' }, [
    el('div', { class: 'rating-header' }, [
      el('h2', {}, ['Rate a few you know']),
      el('p', {}, [`Rate at least ${MIN_RATINGS_TO_CONTINUE} — this is what actually tunes the engine.`]),
      el('button', { class: 'btn btn-ghost', onclick: () => importInput.click() }, [
        'Import from Letterboxd',
      ]),
      importInput,
    ]),
    grid,
    el('div', { class: 'rating-footer' }, [countLabel, continueBtn]),
  ]);

  mount(root, screen);

  for (const seed of RATING_SEEDS) {
    const card = buildCard(seed.id, seed.title, seed.year, null);
    cards.set(seed.id, card);
    grid.appendChild(card);

    // Resolve real posters lazily; the card works fine without one.
    searchTitle(seed.title, seed.tmdbType)
      .then((res) => {
        if (res?.posterPath) setCardPoster(card, posterUrl(res.posterPath, 'md'));
      })
      .catch(() => {});
  }

  syncFromStore();

  function buildCard(id: number, title: string, year: number, posterPath: string | null): HTMLElement {
    const posterWrap = el('div', { class: 'rating-poster skeleton' });
    if (posterPath) setPoster(posterWrap, posterPath);

    const stars = [1, 2, 3, 4, 5].map((n) =>
      el(
        'button',
        {
          class: 'star',
          'aria-label': `Rate ${n} star${n > 1 ? 's' : ''}`,
          onclick: () => rate(id, n as RatingValue),
        },
        ['★']
      )
    );

    const card = el('div', { class: 'rating-card', 'data-id': id }, [
      posterWrap,
      el('p', { class: 'rating-title' }, [`${title} (${year})`]),
      el('div', { class: 'star-row' }, stars),
    ]);
    (card as HTMLElement & { _posterWrap?: HTMLElement })._posterWrap = posterWrap;
    return card;
  }

  function setPoster(wrap: HTMLElement, url: string) {
    wrap.classList.remove('skeleton');
    wrap.style.backgroundImage = `url(${url})`;
  }

  function setCardPoster(card: HTMLElement, url: string | null) {
    if (!url) return;
    const wrap = (card as HTMLElement & { _posterWrap?: HTMLElement })._posterWrap;
    if (wrap) setPoster(wrap, url);
  }

  function rate(id: number, value: RatingValue) {
    store.setRating(id, value);
    const card = cards.get(id);
    if (card) {
      const starEls = card.querySelectorAll<HTMLButtonElement>('.star');
      starEls.forEach((s, i) => s.classList.toggle('filled', i < value));
    }
    syncFromStore();
  }

  function syncFromStore() {
    const count = Object.keys(store.getState().ratings).length;
    countLabel.textContent = `${count} rated`;
    continueBtn.toggleAttribute('disabled', count < MIN_RATINGS_TO_CONTINUE);
  }

  function onImportFile(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    file.text().then((text) => {
      const rows = parseLetterboxdCsv(text);
      // Match imported rows against our seed list by title; anything not
      // in the seed list still contributes to taste even without a visible
      // card, via a synthetic negative id namespace to avoid collisions.
      const imported: Record<number, RatingValue> = {};
      for (const row of rows) {
        const seed = RATING_SEEDS.find((s) => s.title.toLowerCase() === row.title.toLowerCase());
        if (seed) imported[seed.id] = row.rating as RatingValue;
      }
      store.importRatings(imported);
      for (const [idStr, value] of Object.entries(imported)) {
        const id = Number(idStr);
        const card = cards.get(id);
        if (card) {
          const starEls = card.querySelectorAll<HTMLButtonElement>('.star');
          starEls.forEach((s, i) => s.classList.toggle('filled', i < value));
        }
      }
      syncFromStore();
    });
  }

  function onContinue() {
    store.setScreen('results');
  }

  return () => {};
}
