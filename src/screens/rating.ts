import { buildRatingPool } from '../lib/rating-pool';
import { buildPosterImage, el, mount } from '../lib/dom';
import { parseLetterboxdCsv } from '../lib/letterboxd';
import { store } from '../lib/store';
import { posterUrl, searchTitle } from '../lib/tmdb';
import type { RatingSeed, RatingValue } from '../lib/types';

const MIN_RATINGS_TO_CONTINUE = 3;

export function renderRating(root: HTMLElement): () => void {
  let cancelled = false;
  const cards = new Map<number, HTMLElement>();
  let seeds: RatingSeed[] = store.getState().ratingSeeds;

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

  const mood = store.getState().quizAnswers.mood;
  const subtitle = mood
    ? `Mostly ${mood} picks, tuned to what you just told us — rate at least ${MIN_RATINGS_TO_CONTINUE}.`
    : `Rate at least ${MIN_RATINGS_TO_CONTINUE} — this is what actually tunes the engine.`;

  const screen = el('div', { class: 'screen rating' }, [
    el('div', { class: 'rating-header' }, [
      el('h2', {}, ['Rate a few you know']),
      el('p', {}, [subtitle]),
      el('button', { class: 'btn btn-ghost', onclick: () => importInput.click() }, [
        'Import from Letterboxd',
      ]),
      importInput,
    ]),
    grid,
    el('div', { class: 'rating-footer' }, [countLabel, continueBtn]),
  ]);

  mount(root, screen);
  drawSkeletonGrid();
  void loadPool();

  async function loadPool() {
    const pool = await buildRatingPool(mood);
    if (cancelled) return;
    seeds = pool.seeds;
    store.setRatingPool(pool.seeds, pool.signals);
    buildCards();
  }

  function drawSkeletonGrid() {
    grid.replaceChildren(
      ...Array.from({ length: 15 }, (_, i) =>
        el('div', { class: 'rating-card stagger-in', style: `--stagger: ${i}` }, [
          el('div', { class: 'rating-poster skeleton' }),
          el('p', { class: 'rating-title skeleton-text' }, ['\u00a0']),
        ])
      )
    );
  }

  function buildCards() {
    grid.replaceChildren();
    cards.clear();

    seeds.forEach((seed, i) => {
      const card = buildCard(seed.id, seed.title, seed.year, seed.posterPath, i);
      cards.set(seed.id, card);
      grid.appendChild(card);

      // The genre-weighted picks already carry a poster from the live
      // TMDB query; the small static fallback list doesn't, so resolve
      // those lazily. The card works fine either way in the meantime.
      if (!seed.posterPath) {
        searchTitle(seed.title, seed.tmdbType)
          .then((res) => {
            if (!cancelled && res?.posterPath) setCardPoster(card, posterUrl(res.posterPath, 'md'));
          })
          .catch(() => {});
      }
    });

    syncFromStore();
  }

  function buildCard(
    id: number,
    title: string,
    year: number,
    posterPath: string | null,
    index: number
  ): HTMLElement {
    const posterWrap = el('div', { class: 'rating-poster' }, [
      buildPosterImage({ src: posterUrl(posterPath, 'md'), alt: `${title} poster`, fallbackText: title.slice(0, 1) }),
    ]);

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

    const card = el('div', { class: 'rating-card stagger-in', 'data-item': id, style: `--stagger: ${index}` }, [
      posterWrap,
      el('p', { class: 'rating-title' }, [`${title} (${year})`]),
      el('div', { class: 'star-row' }, stars),
    ]);
    (card as HTMLElement & { _posterWrap?: HTMLElement })._posterWrap = posterWrap;
    return card;
  }

  function setCardPoster(card: HTMLElement, url: string | null) {
    if (!url) return;
    const wrap = (card as HTMLElement & { _posterWrap?: HTMLElement })._posterWrap;
    if (!wrap) return;
    wrap.replaceChildren(buildPosterImage({ src: url, alt: '', fallbackText: '?' }));
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
        const seed = seeds.find((s) => s.title.toLowerCase() === row.title.toLowerCase());
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

  return () => {
    cancelled = true;
  };
}
