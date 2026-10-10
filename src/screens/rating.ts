import { buildRatingPool } from '../lib/rating-pool';
import { buildPosterImage, el, mount } from '../lib/dom';
import { parseLetterboxdCsv } from '../lib/letterboxd';
import { keyOf, parseMediaKey } from '../lib/media-key';
import { hasDeliberateRating, recordImportedRatings, recordSeedRating } from '../lib/profile';
import { store } from '../lib/store';
import { findCatalogItem, isTmdbConfigured, posterUrl, searchTitle } from '../lib/tmdb';
import type { CatalogItem } from '../lib/types';
import type { RatingSeed, RatingValue } from '../lib/types';

const MIN_RATINGS_TO_CONTINUE = 3;
const CONTINUE_LABEL = 'Get my recommendations →';

export function renderRating(root: HTMLElement): () => void {
  let cancelled = false;
  const cards = new Map<string, HTMLElement>();
  let seeds: RatingSeed[] = store.getState().ratingSeeds;
  // Media keys of the imported library. A set (not a running total) so a film
  // appearing twice, or also on a card, is only counted once. It always
  // mirrors the *latest* import — see runImport.
  const libraryKeys = new Set<string>();
  // Aborts in-flight TMDB lookups when the screen is left.
  const abort = new AbortController();
  // Imports are chained through importQueue (see onImportFile); pendingImports
  // counts running + queued ones. Declared up front because syncFromStore reads it.
  let importQueue: Promise<void> = Promise.resolve();
  let pendingImports = 0;

  const grid = el('div', { class: 'rating-grid' });
  const continueBtn = el(
    'button',
    { class: 'btn btn-primary', onclick: onContinue, disabled: true },
    [CONTINUE_LABEL]
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
      const card = buildCard(seed, i);
      cards.set(keyOf(seed), card);
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

    // Cards are rebuilt when the pool finishes loading, so stars for anything
    // already rated or imported (e.g. while the skeleton grid was showing, or
    // on a return visit to this screen) must be restored, not just counted.
    paintImported(store.getState().ratings);
    syncFromStore();
  }

  function buildCard(seed: RatingSeed, index: number): HTMLElement {
    const { title, year, posterPath } = seed;
    const key = keyOf(seed);
    const posterWrap = el('div', { class: 'rating-poster' }, [
      buildPosterImage({ src: posterUrl(posterPath, 'md'), alt: `${title} poster`, fallbackText: title.slice(0, 1) }),
    ]);

    const stars = [1, 2, 3, 4, 5].map((n) =>
      el(
        'button',
        {
          class: 'star',
          type: 'button',
          'aria-label': `Rate ${n} star${n > 1 ? 's' : ''} \u2014 ${title}`,
          onclick: () => rate(seed, n as RatingValue),
        },
        ['★']
      )
    );

    const card = el('div', { class: 'rating-card stagger-in', 'data-item': key, style: `--stagger: ${index}` }, [
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

  function rate(seed: RatingSeed, value: RatingValue) {
    const key = keyOf(seed);
    store.setRating(key, value);
    const card = cards.get(key);
    if (card) {
      card.classList.remove('just-rated');
      void card.offsetWidth; // restart the confirmation animation
      card.classList.add('just-rated');
      paintCard(card, value);
    }
    const signals = store.getState().ratingSignals[key] ?? [];
    recordSeedRating(seed, signals, value);
    syncFromStore();
  }

  function paintCard(card: HTMLElement, value: number) {
    card.classList.toggle('is-rated', value > 0);
    card.querySelectorAll<HTMLButtonElement>('.star').forEach((s, i) => {
      s.classList.toggle('filled', i < value);
      s.setAttribute('aria-pressed', i === value - 1 ? 'true' : 'false');
    });
  }

  /** Repaints every card from the store — used after a re-import so ratings
   * that the new file superseded don't keep showing stars. */
  function paintAllFromStore() {
    const ratings = store.getState().ratings;
    for (const [key, card] of cards) paintCard(card, ratings[key] ?? 0);
  }

  function ratedCount(): number {
    const keys = new Set<string>(Object.keys(store.getState().ratings));
    for (const k of libraryKeys) keys.add(k);
    return keys.size;
  }

  function syncFromStore() {
    const count = ratedCount();
    countLabel.textContent = `${count} rated`;
    // Continue is held back while any import is running or queued: leaving the
    // screen cancels unfinished imports, so continuing early would score the
    // recommendations from an older file instead of the one just selected.
    const importing = pendingImports > 0;
    continueBtn.toggleAttribute('disabled', importing || count < MIN_RATINGS_TO_CONTINUE);
    continueBtn.textContent = importing ? 'Importing your library\u2026' : CONTINUE_LABEL;
  }

  const IMPORT_CAP = 400; // most recent rows; keeps TMDB lookups bounded
  const IMPORT_CONCURRENCY = 5;

  // Imports run strictly one at a time, in the order the files were picked.
  // Each import mutates shared state (session ratings, profile, card stars,
  // library ids); if two ran concurrently the slower, older file could finish
  // last and overwrite overlapping ratings from the newer one. Chaining them
  // keeps the last-selected file authoritative while still letting a finished
  // import be updated by a later one.

  /** Import progress text, with a note when more files are waiting behind it. */
  function setImportStatus(message: string) {
    const waiting = pendingImports - 1;
    importStatus.textContent = waiting > 0 ? `${message} (${waiting} more queued)` : message;
  }

  function onImportFile(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    input.value = '';

    if (pendingImports > 0) importStatus.textContent = 'Another import is still running \u2014 yours is queued.';
    pendingImports++;
    syncFromStore(); // disables Continue right away
    importQueue = importQueue
      .then(() => (cancelled ? undefined : runImport(file)))
      .catch(() => {
        if (!cancelled) setImportStatus('Import failed \u2014 please try again.');
      })
      .finally(() => {
        pendingImports--;
        if (!cancelled) syncFromStore();
      });
  }

  async function runImport(file: File): Promise<void> {
    const text = await file.text();
    if (cancelled) return;
    const rows = parseLetterboxdCsv(text).slice(-IMPORT_CAP);
    if (rows.length === 0) {
      setImportStatus('That file didn\u2019t look like a Letterboxd ratings.csv \u2014 export it from Settings \u2192 Data.');
      return;
    }

    let unmatched = 0;
    let done = 0;

    // Without TMDB we can only match against the cards on screen.
    if (!isTmdbConfigured) {
      const imported: Record<string, RatingValue> = {};
      for (const row of rows) {
        const seed = seeds.find((s) => s.title.toLowerCase() === row.title.toLowerCase() && (!row.year || s.year === row.year));
        if (!seed) {
          unmatched++;
          continue;
        }
        // A rating given in the app beats an imported one. A session rating
        // that came from an earlier import does not, so a re-import can
        // update it; in-app ratings are always recorded in the profile.
        if (hasDeliberateRating(seed)) continue;
        imported[keyOf(seed)] = row.rating as RatingValue;
      }
      applyImport(imported);
      setImportStatus(`Matched ${Object.keys(imported).length} of ${rows.length}. Add a TMDB key to match the rest of your library.`);
      syncFromStore();
      return;
    }

    // Lookups finish out of order, so results are slotted by row index and
    // flattened afterwards. That keeps the outcome (including which row wins
    // when two rows resolve to the same film) independent of network timing.
    const slots = Array.from({ length: rows.length }, (): { item: CatalogItem; stars: number } | null => null);
    let next = 0;
    const worker = async () => {
      while (next < rows.length && !cancelled) {
        const index = next++;
        const row = rows[index]!;
        try {
          const item = await findCatalogItem(row.title, row.year, abort.signal);
          if (item) slots[index] = { item, stars: row.stars };
          else unmatched++;
        } catch {
          unmatched++;
        }
        done++;
        if (!cancelled) setImportStatus(`Matching your library\u2026 ${done} of ${rows.length}`);
      }
    };
    await Promise.all(Array.from({ length: IMPORT_CONCURRENCY }, worker));
    if (cancelled) return;
    const matched = slots.filter((m): m is { item: CatalogItem; stars: number } => m !== null);

    // Whole library, persisted and de-duplicated by TMDB id: all of it
    // calibrates the engine, not only titles that happen to be on a card.
    const keptIds = recordImportedRatings(matched);

    // Titles that are also visible as seed cards light up their stars.
    const imported: Record<string, RatingValue> = {};
    for (const m of matched) {
      // Only ratings given in the app are protected; a session rating left
      // by an earlier import is replaced by this file's value.
      const k = keyOf(m.item);
      if (keptIds.has(k)) continue;
      if (seeds.some((s) => keyOf(s) === k)) imported[k] = Math.max(1, Math.min(5, Math.round(m.stars))) as RatingValue;
    }
    applyImport(imported);

    // The library itself counts toward the "rate a few" requirement. It is
    // rebuilt (not appended to): the latest file is the whole library.
    libraryKeys.clear();
    for (const m of matched) libraryKeys.add(keyOf(m.item));
    setImportStatus(`Imported ${rows.length} films \u00b7 matched ${matched.length} \u00b7 couldn\u2019t identify ${unmatched}.`);
    syncFromStore();
  }

  /** Session ratings = ratings the person gave in the app + this file's
   * ratings. Anything a previous import put there that this file doesn't
   * contain is dropped, so a smaller re-import really replaces the old one. */
  function applyImport(imported: Record<string, RatingValue>) {
    const next: Record<string, RatingValue> = {};
    for (const [k, v] of Object.entries(store.getState().ratings)) {
      const ref = parseMediaKey(k);
      if (ref && hasDeliberateRating(ref)) next[k] = v;
    }
    Object.assign(next, imported);
    store.replaceRatings(next);
    paintAllFromStore();
  }

  function paintImported(imported: Record<string, RatingValue>) {
    for (const [key, value] of Object.entries(imported)) {
      const card = cards.get(key);
      if (card) paintCard(card, value);
    }
  }

  function onContinue() {
    if (pendingImports > 0) return; // belt and braces: the button is also disabled
    store.setScreen('results');
  }

  return () => {
    cancelled = true;
    abort.abort();
  };
}
