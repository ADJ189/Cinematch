import { SEED_SIGNALS, RATING_SEEDS } from '../data/rating-seeds';
import { RecommendationEngine } from '../lib/engine';
import { el, mount } from '../lib/dom';
import { store } from '../lib/store';
import { discoverCandidates, isTmdbConfigured, posterUrl, backdropUrl, tmdbDetailsUrl } from '../lib/tmdb';
import { fetchExternalRatings, isOmdbConfigured } from '../lib/omdb';
import { enableLocalAi, explainPick, getLlmStatus, getLlmStatusDetail } from '../lib/llm';
import type { CatalogItem, RatingValue, ScoredItem } from '../lib/types';

const BATCH_SIZE = 24;
const AI_REASON_LIMIT = 8;
const MAX_PAGE_OFFSET = 18; // ~6 refreshes of live TMDB pages before we start reusing the pool

function summarizeQuiz(state: ReturnType<typeof store.getState>): string {
  const { mood, vibe, era, company } = state.quizAnswers;
  return [mood, vibe, era !== 'any' ? era : null, company]
    .filter(Boolean)
    .join(', ') || 'no strong preference stated';
}

export function renderResults(root: HTMLElement): () => void {
  let cancelled = false;

  // Screen-local state. Ratings collected here (on top of the seed
  // calibration ratings already in the store) are the "rate more, get a
  // more curated response" loop — they never leave this screen's memory,
  // so restarting the flow starts clean.
  const quizAnswers = store.getState().quizAnswers;
  const seedRatings = store.getState().ratings;
  const resultRatings = new Map<number, RatingValue>();
  const itemsById = new Map<number, CatalogItem>();
  const shownIds = new Set<number>();
  let allCandidates: CatalogItem[] = [];
  let pageOffset = 0;
  let refreshing = false;

  const screen = el('div', { class: 'screen results' });
  mount(root, screen);
  drawLoading();
  void run();

  async function run() {
    if (!isTmdbConfigured) {
      drawConfigError();
      return;
    }

    try {
      const candidates = await discoverCandidates(filters());
      if (cancelled) return;
      pageOffset = 3;
      mergeCandidates(candidates);

      const batch = rescore(BATCH_SIZE);
      if (cancelled) return;

      if (batch.length === 0) {
        drawEmpty();
        return;
      }

      await enrichWithExternalRatings(batch);
      if (cancelled) return;

      store.setResults(batch);
      draw(batch);
    } catch (err) {
      if (cancelled) return;
      const message = err instanceof Error ? err.message : 'Something went wrong fetching results.';
      store.setError(message);
      drawError(message);
    }
  }

  function filters() {
    return {
      mood: quizAnswers.mood,
      vibe: quizAnswers.vibe,
      era: quizAnswers.era,
      format: quizAnswers.format,
      language: quizAnswers.language,
    };
  }

  function mergeCandidates(items: CatalogItem[]) {
    for (const item of items) {
      if (!itemsById.has(item.id)) {
        itemsById.set(item.id, item);
        allCandidates.push(item);
      }
    }
  }

  /** Rebuilds the engine from scratch each time — quiz + seed ratings +
   * every result rating collected so far — and returns the next unseen
   * batch. Titles the user has directly rated are excluded from the pool:
   * they've already gotten a verdict, repeating them adds nothing. */
  function rescore(count: number): ScoredItem[] {
    const engine = new RecommendationEngine();
    engine.processQuiz(quizAnswers);
    engine.processRatings(seedRatings, RATING_SEEDS, SEED_SIGNALS);
    for (const [id, rating] of resultRatings) {
      const item = itemsById.get(id);
      if (item) engine.processResultRating(item, rating);
    }

    const pool = allCandidates.filter((c) => !resultRatings.has(c.id));
    const scored = engine.getResults(pool, SEED_SIGNALS);
    const unseen = scored.filter((r) => !shownIds.has(r.id));
    const batch = unseen.slice(0, count);
    for (const item of batch) shownIds.add(item.id);
    return batch;
  }

  async function enrichWithExternalRatings(batch: ScoredItem[]) {
    if (!isOmdbConfigured) return;
    const top = batch.slice(0, AI_REASON_LIMIT);
    await Promise.all(
      top.map(async (item) => {
        const ext = await fetchExternalRatings(item.title, item.year);
        if (ext) item.externalRatings = ext;
      })
    );
  }

  async function onDifferentPicks(btn: HTMLElement) {
    if (refreshing) return;
    refreshing = true;
    btn.setAttribute('disabled', '');
    btn.textContent = 'Finding more…';

    try {
      let batch = rescore(BATCH_SIZE);

      // Not enough fresh titles left in the pool we already have — pull a
      // later page window from TMDB instead of re-showing the same list.
      if (batch.length < 8 && pageOffset <= MAX_PAGE_OFFSET) {
        const more = await discoverCandidates(filters(), pageOffset);
        if (cancelled) return;
        pageOffset += 3;
        mergeCandidates(more);
        batch = rescore(BATCH_SIZE);
      }

      // Truly exhausted the live pool for this combination — allow repeats
      // rather than showing an empty screen.
      if (batch.length === 0) {
        shownIds.clear();
        batch = rescore(BATCH_SIZE);
      }

      await enrichWithExternalRatings(batch);
      if (cancelled) return;

      store.setResults(batch);
      draw(batch);
    } catch {
      btn.removeAttribute('disabled');
      btn.textContent = '🔀 Show me different picks';
    } finally {
      refreshing = false;
    }
  }

  function onRateResult(item: ScoredItem, value: RatingValue) {
    resultRatings.set(item.id, value);
    const batch = rescore(BATCH_SIZE);
    store.setResults(batch);
    draw(batch);
  }

  function drawLoading() {
    const grid = el(
      'div',
      { class: 'results-grid' },
      Array.from({ length: 8 }, () => el('div', { class: 'result-card skeleton-card' }, [
        el('div', { class: 'result-poster skeleton' }),
      ]))
    );
    mount(screen, el('div', {}, [
      el('h2', {}, ['Finding your matches…']),
      el('p', {}, ['Pulling live results from TMDB and scoring against your answers.']),
      grid,
    ]));
  }

  function drawConfigError() {
    mount(
      screen,
      el('div', { class: 'state-message' }, [
        el('h2', {}, ['TMDB isn\u2019t configured yet']),
        el('p', {}, [
          'Add a free TMDB API read token as VITE_TMDB_TOKEN in a local .env file, then restart the dev server. See README for the two-minute setup.',
        ]),
        el('button', { class: 'btn btn-ghost', onclick: () => store.setScreen('landing') }, ['← Back']),
      ])
    );
  }

  function drawError(message: string) {
    mount(
      screen,
      el('div', { class: 'state-message' }, [
        el('h2', {}, ['Couldn\u2019t load results']),
        el('p', {}, [message]),
        el('button', { class: 'btn btn-primary', onclick: run }, ['Try again']),
      ])
    );
  }

  function drawEmpty() {
    mount(
      screen,
      el('div', { class: 'state-message' }, [
        el('h2', {}, ['No matches for this combination']),
        el('p', {}, ['Try loosening the era or language filter.']),
        el('button', { class: 'btn btn-ghost', onclick: () => store.setScreen('quiz') }, ['← Adjust answers']),
      ])
    );
  }

  function draw(results: ScoredItem[]) {
    const aiBtn = el(
      'button',
      { class: 'btn btn-ghost' },
      [llmButtonLabel()]
    );
    aiBtn.addEventListener('click', () => toggleLocalAi(aiBtn, results));

    const differentBtn = el(
      'button',
      { class: 'btn btn-ghost' },
      ['🔀 Show me different picks']
    );
    differentBtn.addEventListener('click', () => onDifferentPicks(differentBtn));

    const ratedCount = resultRatings.size;
    const header = el('div', { class: 'results-header' }, [
      el('h2', {}, ['Your matches']),
      el('p', {}, [
        `${results.length} titles, ranked and scored against your answers.`,
        ratedCount > 0 ? ` You've rated ${ratedCount} result${ratedCount === 1 ? '' : 's'} — picks keep adjusting.` : '',
      ]),
      el('div', { class: 'results-actions' }, [
        differentBtn,
        aiBtn,
        el('button', { class: 'btn btn-ghost', onclick: restart }, ['Start over']),
      ]),
    ]);

    const grid = el(
      'div',
      { class: 'results-grid' },
      results.map((item, i) => buildCard(item, i))
    );

    mount(screen, el('div', {}, [header, grid]));

    if (getLlmStatus() === 'ready') void refreshReasons(results, grid);
  }

  function llmButtonLabel(): string {
    const status = getLlmStatus();
    if (status === 'ready') return '✨ On-device AI: on';
    if (status === 'loading') return 'Loading on-device model…';
    if (status === 'error') return '⚠️ On-device AI unavailable — retry';
    return '✨ Explain picks with on-device AI';
  }

  async function toggleLocalAi(btn: HTMLElement, results: ScoredItem[]) {
    if (getLlmStatus() === 'ready') return;
    btn.setAttribute('disabled', '');
    btn.textContent = 'Loading on-device model…';
    try {
      await enableLocalAi((pct) => {
        btn.textContent = `Loading on-device model… ${pct}%`;
      });
      btn.textContent = llmButtonLabel();
      const grid = screen.querySelector<HTMLElement>('.results-grid');
      if (grid) await refreshReasons(results, grid);
    } catch {
      btn.textContent = llmButtonLabel();
      btn.title = getLlmStatusDetail();
    } finally {
      btn.removeAttribute('disabled');
    }
  }

  async function refreshReasons(results: ScoredItem[], grid: HTMLElement) {
    const summary = summarizeQuiz(store.getState());
    const cards = grid.querySelectorAll<HTMLElement>('.result-reasons');
    await Promise.all(
      results.slice(0, AI_REASON_LIMIT).map(async (item, i) => {
        const sentence = await explainPick(item, summary);
        const listEl = cards[i];
        if (listEl) listEl.replaceChildren(el('li', { class: 'ai-reason' }, [sentence]));
      })
    );
  }

  function buildStarRow(
    itemId: number,
    current: RatingValue | undefined,
    onRate: (v: RatingValue) => void
  ): HTMLElement {
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
    return el('div', { class: 'star-row star-row-sm', 'data-item': itemId }, stars);
  }

  function buildCard(item: ScoredItem, index: number): HTMLElement {
    const poster = posterUrl(item.posterPath, 'md');
    const ratingBadge = item.externalRatings?.rottenTomatoes
      ? el('span', { class: 'badge badge-rt' }, [`🍅 ${item.externalRatings.rottenTomatoes}%`])
      : null;

    const card = el('article', {
      class: 'result-card',
      style: `--stagger: ${Math.min(index, 20)}`,
    }, [
      el('div', {
        class: 'result-poster',
        onclick: () => openDetailModal(item),
        style: poster ? `background-image: url(${poster})` : undefined,
      }, poster ? [
        el('span', { class: 'result-poster-overlay' }, ['ℹ️ Details']),
      ] : [el('span', { class: 'poster-fallback' }, [item.title.slice(0, 1)])]),
      el('div', { class: 'result-body' }, [
        el('div', { class: 'result-match' }, [`${item.matchPct}% match`]),
        el('h3', { class: 'result-title', onclick: () => openDetailModal(item) }, [`${item.title} (${item.year})`]),
        ...(ratingBadge ? [ratingBadge] : []),
        el(
          'ul',
          { class: 'result-reasons' },
          item.reasons.map((r) => el('li', {}, [r]))
        ),
        buildStarRow(item.id, resultRatings.get(item.id), (v) => onRateResult(item, v)),
      ]),
    ]);

    return card;
  }

  // ── Movie info modal — "check the info before watching" ─────────────
  function openDetailModal(item: ScoredItem) {
    const backdrop = backdropUrl(item.backdropPath) ?? posterUrl(item.posterPath, 'xl');

    const ratingsLine: string[] = [`⭐ ${item.voteAverage.toFixed(1)}/10 TMDB (${item.voteCount.toLocaleString()} votes)`];
    if (item.externalRatings?.rottenTomatoes !== undefined) ratingsLine.push(`🍅 ${item.externalRatings.rottenTomatoes}%`);
    if (item.externalRatings?.metacritic !== undefined) ratingsLine.push(`Ⓜ️ ${item.externalRatings.metacritic}`);
    if (item.externalRatings?.imdbRating !== undefined) ratingsLine.push(`IMDb ${item.externalRatings.imdbRating}`);

    const overlay = el('div', { class: 'modal-overlay', role: 'dialog', 'aria-modal': 'true' });
    const closeBtn = el('button', { class: 'modal-close', 'aria-label': 'Close' }, ['✕']);

    const modal = el('div', { class: 'modal-card' }, [
      closeBtn,
      el('div', {
        class: 'modal-hero',
        style: backdrop ? `background-image: url(${backdrop})` : undefined,
      }),
      el('div', { class: 'modal-body' }, [
        el('div', { class: 'result-match modal-match' }, [`${item.matchPct}% match`]),
        el('h2', {}, [`${item.title} (${item.year})`]),
        el('p', { class: 'modal-meta' }, [
          [item.type === 'movie' ? 'Movie' : 'Series', ...item.genres, ...item.vibe].join(' · '),
        ]),
        el('p', { class: 'modal-ratings' }, [ratingsLine.join('   ')]),
        el('p', { class: 'modal-overview' }, [item.overview || 'No synopsis available.']),
        el('div', { class: 'modal-actions' }, [
          el(
            'a',
            { class: 'btn btn-ghost', href: tmdbDetailsUrl(item.id, item.tmdbType), target: '_blank', rel: 'noopener' },
            ['View trailer & full details ↗']
          ),
        ]),
        el('p', { class: 'modal-rate-label' }, ['Rate it, or rate it after you watch — either sharpens your picks:']),
        buildStarRow(item.id, resultRatings.get(item.id), (v) => {
          onRateResult(item, v);
          close();
        }),
      ]),
    ]);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';

    function close() {
      overlay.remove();
      document.body.style.overflow = '';
      document.removeEventListener('keydown', onKey);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close();
    }

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
    closeBtn.addEventListener('click', close);
    document.addEventListener('keydown', onKey);
  }

  function restart() {
    store.reset();
    store.setScreen('landing');
  }

  return () => {
    cancelled = true;
  };
}
