import { buildRatingPool } from '../lib/rating-pool';
import { buildPosterImage, el, mount } from '../lib/dom';
import { parseLetterboxdCsv } from '../lib/letterboxd';
import { hasDeliberateRating, recordImportedRatings, recordSeedRating } from '../lib/profile';
import { store } from '../lib/store';
import { findCatalogItem, isTmdbConfigured, posterUrl, searchTitle } from '../lib/tmdb';
import type { CatalogItem } from '../lib/types';
import type { RatingSeed, RatingValue } from '../lib/types';

const MIN_RATINGS_TO_CONTINUE = 3;

export function renderRating(root: HTMLElement): () => void {
  let cancelled = false;
  const cards = new Map<number, HTMLElement>();
  let seeds: RatingSeed[] = store.getState().ratingSeeds;
  let libraryCount = 0;

  const grid = el('div', { class: 'rating-grid' });
  const continueBtn = el(
    'button',
    { class: 'btn btn-primary', onclick: onContinue, disabled: true },
    ['Get my recommendations →']
  );
  const countLabel = el('span', { class: 'rating-count' }, ['0 rated']);

  const importStatus = el('p', { class: 'import-status', role: 'status', 'aria-live': 'polite' });
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
        'Import your Letterboxd history',
      ]),
      importInput,
      importStatus,
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
      if (!seed.posterPath && isTmdbConfigured) {
        searchTitle(seed.title, seed.tmdbType, seed.year)
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
    const seed = seeds.find((s) => s.id === id);
    if (seed) {
      const signals = store.getState().ratingSignals[id] ?? [];
      recordSeedRating(seed, signals, value);
    }
    syncFromStore();
  }

  function syncFromStore() {
    const count = Object.keys(store.getState().ratings).length + libraryCount;
    countLabel.textContent = `${count} rated`;
    continueBtn.toggleAttribute('disabled', count < MIN_RATINGS_TO_CONTINUE);
  }

  const IMPORT_CAP = 400; // most recent rows; keeps TMDB lookups bounded
  const IMPORT_CONCURRENCY = 5;

  function onImportFile(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    input.value = '';

    void file.text().then(async (text) => {
      const rows = parseLetterboxdCsv(text).slice(-IMPORT_CAP);
      if (rows.length === 0) {
        importStatus.textContent = 'That file didn\u2019t look like a Letterboxd ratings.csv \u2014 export it from Settings \u2192 Data.';
        return;
      }

      const matched: { item: CatalogItem; stars: number }[] = [];
      let unmatched = 0;
      let done = 0;

      // Without TMDB we can only match against the cards on screen.
      if (!isTmdbConfigured) {
        const imported: Record<number, RatingValue> = {};
        const sessionRatings = store.getState().ratings;
        for (const row of rows) {
          const seed = seeds.find((s) => s.title.toLowerCase() === row.title.toLowerCase() && (!row.year || s.year === row.year));
          if (!seed) {
            unmatched++;
            continue;
          }
          // A rating given in the app beats an imported one.
          if (sessionRatings[seed.id] !== undefined || hasDeliberateRating(seed.id)) continue;
          imported[seed.id] = row.rating as RatingValue;
        }
        store.importRatings(imported);
        paintImported(imported);
        importStatus.textContent = `Matched ${Object.keys(imported).length} of ${rows.length}. Add a TMDB key to match the rest of your library.`;
        syncFromStore();
        return;
      }

      let next = 0;
      const worker = async () => {
        while (next < rows.length && !cancelled) {
          const row = rows[next++]!;
          try {
            const item = await findCatalogItem(row.title, row.year);
            if (item) matched.push({ item, stars: row.stars });
            else unmatched++;
          } catch {
            unmatched++;
          }
          done++;
          importStatus.textContent = `Matching your library\u2026 ${done} of ${rows.length}`;
        }
      };
      await Promise.all(Array.from({ length: IMPORT_CONCURRENCY }, worker));
      if (cancelled) return;

      // Whole library, persisted and de-duplicated by TMDB id: all of it
      // calibrates the engine, not only titles that happen to be on a card.
      const keptIds = recordImportedRatings(matched);

      // Titles that are also visible as seed cards light up their stars.
      const imported: Record<number, RatingValue> = {};
      for (const m of matched) {
        if (keptIds.has(m.item.id) || store.getState().ratings[m.item.id] !== undefined) continue;
        if (seeds.some((s) => s.id === m.item.id)) imported[m.item.id] = Math.max(1, Math.min(5, Math.round(m.stars))) as RatingValue;
      }
      store.importRatings(imported);
      paintImported(imported);

      // The library itself counts toward the "rate a few" requirement.
      libraryCount = matched.length;
      importStatus.textContent = `Imported ${rows.length} films \u00b7 matched ${matched.length} \u00b7 couldn\u2019t identify ${unmatched}.`;
      syncFromStore();
    });
  }

  function paintImported(imported: Record<number, RatingValue>) {
    for (const [idStr, value] of Object.entries(imported)) {
      const card = cards.get(Number(idStr));
      card?.querySelectorAll<HTMLButtonElement>('.star').forEach((s, i) => s.classList.toggle('filled', i < value));
    }
  }

  function onContinue() {
    store.setScreen('results');
  }

  return () => {
    cancelled = true;
  };
}
