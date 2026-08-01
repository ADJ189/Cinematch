import { RecommendationEngine } from '../lib/engine';
import { buildPosterImage, el, mount } from '../lib/dom';
import { store } from '../lib/store';
import { discoverCandidates, isTmdbConfigured, posterUrl, backdropUrl, tmdbDetailsUrl } from '../lib/tmdb';
import { fetchExternalRatings, isOmdbConfigured } from '../lib/omdb';
import { enableLocalAi, explainPick, getLlmStatus, getLlmStatusDetail } from '../lib/llm';
import type { CatalogItem, RatingValue, ResultsMode, ScoredItem } from '../lib/types';

const GROUPED_SIZE = 24;
const PRECISE_SIZE = 10;
const PRECISE_MIN_MATCH = 68; // precise mode only keeps titles at/above this match%
const AI_REASON_LIMIT = 8;
const MAX_PAGE_OFFSET = 18; // ~6 refreshes of live TMDB pages before we start reusing the pool
// A rating changes the whole grid — give it a beat before recomputing so a
// quick run of taps doesn't re-render on every single click, and so the
// change doesn't feel jarringly instant. Long enough to read as deliberate,
// short enough not to feel like a delay.
const RATE_DEBOUNCE_MS = 1600;

function summarizeQuiz(state: ReturnType<typeof store.getState>): string {
  const { mood, vibe, era, company, contentType } = state.quizAnswers;
  return (
    [mood, vibe, era !== 'any' ? era : null, contentType !== 'live_action' ? contentType : null, company]
      .filter(Boolean)
      .join(', ') || 'no strong preference stated'
  );
}

export function renderResults(root: HTMLElement): () => void {
  let cancelled = false;

  // Screen-local state. Ratings collected here (on top of the seed
  // calibration ratings already in the store) are the "rate more, get a
  // more curated response" loop — they never leave this screen's memory,
  // so restarting the flow starts clean.
  const quizAnswers = store.getState().quizAnswers;
  const seedRatings = store.getState().ratings;
  const ratingSeeds = store.getState().ratingSeeds;
  const ratingSignals = store.getState().ratingSignals;
  const resultRatings = new Map<number, RatingValue>();
  const itemsById = new Map<number, CatalogItem>();
  const shownIds = new Set<number>();
  let allCandidates: CatalogItem[] = [];
  let pageOffset = 0;
  let refreshing = false;
  let mode: ResultsMode = 'grouped';
  let rateTimer: number | null = null;

  const screen = el('div', { class: 'screen results' });
  mount(root, screen);
  drawLoading();
  void run();

  function targetCount(): number {
    return mode === 'precise' ? PRECISE_SIZE : GROUPED_SIZE;
  }

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

      const { batch } = await ensureBatch(targetCount());
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
      contentType: quizAnswers.contentType,
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
   * they've already gotten a verdict, repeating them adds nothing.
   * In precise mode, the pool is also held to a minimum match% so a
   * thinner, more confident list beats a padded-out one.
   *
   * `opts` lets ensureBatch() reuse this for its fallback steps instead of
   * duplicating the scoring pipeline: ignoreShown lifts the "already
   * shown this session" exclusion, ignorePreciseFloor lifts the 68%+ bar. */
  function rescore(count: number, opts: { ignoreShown?: boolean; ignorePreciseFloor?: boolean } = {}): ScoredItem[] {
    const engine = new RecommendationEngine();
    engine.processQuiz(quizAnswers);
    engine.processRatings(seedRatings, ratingSeeds, ratingSignals);
    for (const [id, rating] of resultRatings) {
      const item = itemsById.get(id);
      if (item) engine.processResultRating(item, rating);
    }

    const pool = allCandidates.filter((c) => !resultRatings.has(c.id));
    const scored = engine.getResults(pool, ratingSignals);
    let unseen = opts.ignoreShown ? scored : scored.filter((r) => !shownIds.has(r.id));
    if (mode === 'precise' && !opts.ignorePreciseFloor) unseen = unseen.filter((r) => r.matchPct >= PRECISE_MIN_MATCH);

    const batch = unseen.slice(0, count);
    for (const item of batch) shownIds.add(item.id);
    return batch;
  }

  /**
   * Used to hand back a blank grid the moment `shownIds` (accumulated
   * every time a batch is drawn) happened to cover the whole pool — which,
   * for a narrow filter combination, could be after rating just a
   * handful of results. Escalates through fallbacks instead, and always
   * returns *something* plus an honest note when it had to compromise,
   * rather than a dead end:
   *   1. Retry ignoring `shownIds` — repeats may just be crowding it out.
   *   2. Pull a later page window from TMDB (same as "Different picks").
   *   3. Drop precise mode's 68%+ floor.
   *   4. Last resort: show the pool's best remaining titles regardless of
   *      what's already been shown, with a note explaining why.
   */
  async function ensureBatch(count: number): Promise<{ batch: ScoredItem[]; note: string | null }> {
    let batch = rescore(count);
    if (batch.length > 0) return { batch, note: null };

    batch = rescore(count, { ignoreShown: true });
    if (batch.length > 0) return { batch, note: null };

    if (pageOffset <= MAX_PAGE_OFFSET) {
      try {
        const more = await discoverCandidates(filters(), pageOffset);
        pageOffset += 3;
        mergeCandidates(more);
        batch = rescore(count, { ignoreShown: true });
        if (batch.length > 0) return { batch, note: null };
      } catch {
        // A failed refresh isn't fatal here — still try the fallbacks below.
      }
    }

    if (mode === 'precise') {
      batch = rescore(count, { ignoreShown: true, ignorePreciseFloor: true });
      if (batch.length > 0) {
        return {
          batch,
          note: "You've rated through every tight match — here are the next-best picks, just outside the Precise cutoff.",
        };
      }
    }

    batch = rescore(count, { ignoreShown: true, ignorePreciseFloor: true });
    return {
      batch,
      note:
        batch.length > 0
          ? 'You\u2019ve rated your way through everything fresh for this combination \u2014 showing the best matches again. \u201cDifferent picks\u201d or loosening the era/language filter will surface more variety.'
          : null,
    };
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
      const { batch, note } = await ensureBatch(targetCount());
      if (cancelled) return;

      await enrichWithExternalRatings(batch);
      if (cancelled) return;

      store.setResults(batch);
      draw(batch, note);
    } catch {
      btn.removeAttribute('disabled');
      btn.textContent = '🔀 Show me different picks';
    } finally {
      refreshing = false;
    }
  }

  async function setMode(next: ResultsMode) {
    if (mode === next || refreshing) return;
    refreshing = true;
    mode = next;
    // Switching bands is itself a fresh request — start the "seen" set
    // over so precise mode can freely pick from titles a wider grouped
    // batch already showed, and vice versa.
    shownIds.clear();
    try {
      const { batch, note } = await ensureBatch(targetCount());
      if (cancelled) return;
      store.setResults(batch);
      draw(batch, note);
    } finally {
      refreshing = false;
    }
  }

  /** Updates the star buttons for one item wherever they currently appear
   * (grid card, and the modal if it's open) — instant feedback — then
   * debounces the actual re-curation so a burst of ratings doesn't
   * re-render the whole grid on every tap. Routes through ensureBatch
   * instead of a bare rescore(): for a narrow filter combination,
   * `shownIds` can end up covering the whole live pool after just a
   * handful of ratings, and a bare rescore() would then hand back an
   * empty batch with nothing on screen to explain why. */
  function onRateResult(item: ScoredItem, value: RatingValue) {
    resultRatings.set(item.id, value);
    updateStarVisual(item.id, value);
    setCurating(true);

    if (rateTimer !== null) window.clearTimeout(rateTimer);
    rateTimer = window.setTimeout(() => {
      rateTimer = null;
      void (async () => {
        const { batch, note } = await ensureBatch(targetCount());
        if (cancelled) return;
        store.setResults(batch);
        draw(batch, note);
      })();
    }, RATE_DEBOUNCE_MS);
  }

  function updateStarVisual(itemId: number, value: RatingValue) {
    screen.querySelectorAll<HTMLElement>(`[data-item="${itemId}"]`).forEach((row) => {
      row.querySelectorAll<HTMLButtonElement>('.star').forEach((s, i) => s.classList.toggle('filled', i < value));
    });
  }

  function setCurating(active: boolean) {
    screen.querySelector('.curating-indicator')?.classList.toggle('visible', active);
  }

  function drawLoading() {
    const grid = el(
      'div',
      { class: 'results-grid' },
      Array.from({ length: 8 }, (_, i) =>
        el('div', { class: 'result-card skeleton-card stagger-in', style: `--stagger: ${i}` }, [
          el('div', { class: 'result-poster skeleton' }),
        ])
      )
    );
    mount(
      screen,
      el('div', {}, [
        el('div', { class: 'loading-banner' }, [
          el('span', { class: 'spinner', 'aria-hidden': 'true' }),
          el('div', {}, [
            el('h2', {}, ['Finding your matches…']),
            el('p', {}, ['Pulling live results from TMDB and scoring against your answers.']),
          ]),
        ]),
        grid,
      ])
    );
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
        el('p', {}, ['Try loosening the era or language filter, or switch to Grouped mode.']),
        el('button', { class: 'btn btn-ghost', onclick: () => store.setScreen('quiz') }, ['← Adjust answers']),
      ])
    );
  }

  function draw(results: ScoredItem[], note: string | null = null) {
    const aiBtn = el('button', { class: 'btn btn-ghost toolbar-btn' }, [llmButtonLabel()]);
    aiBtn.addEventListener('click', () => toggleLocalAi(aiBtn, results));

    const differentBtn = el('button', { class: 'btn btn-ghost toolbar-btn' }, ['🔀 Different picks']);
    differentBtn.addEventListener('click', () => onDifferentPicks(differentBtn));

    const modeToggle = el('div', { class: 'mode-toggle', role: 'tablist', 'aria-label': 'Results mode' }, [
      el(
        'button',
        {
          class: `mode-btn${mode === 'grouped' ? ' active' : ''}`,
          role: 'tab',
          'aria-selected': mode === 'grouped' ? 'true' : 'false',
          onclick: () => setMode('grouped'),
        },
        ['Grouped']
      ),
      el(
        'button',
        {
          class: `mode-btn${mode === 'precise' ? ' active' : ''}`,
          role: 'tab',
          'aria-selected': mode === 'precise' ? 'true' : 'false',
          onclick: () => setMode('precise'),
        },
        ['Precise']
      ),
    ]);

    const ratedCount = resultRatings.size;
    const header = el('div', { class: 'results-header' }, [
      el('h2', {}, ['Your matches']),
      el('p', { class: 'results-subline' }, [
        mode === 'precise'
          ? `${results.length} tightly-matched titles (${PRECISE_MIN_MATCH}%+ match).`
          : `${results.length} titles, ranked and scored against your answers.`,
        ratedCount > 0 ? ` You've rated ${ratedCount} result${ratedCount === 1 ? '' : 's'} — picks keep adjusting.` : '',
        ' ',
        el('span', { class: 'curating-indicator' }, ['Curating your picks…']),
      ]),
      el('div', { class: 'results-toolbar' }, [
        modeToggle,
        el('div', { class: 'toolbar-group' }, [
          differentBtn,
          aiBtn,
          el('button', { class: 'btn btn-ghost toolbar-btn', onclick: restart }, ['Start over']),
        ]),
      ]),
      // A note from ensureBatch() — shown whenever it had to compromise
      // to avoid a dead end (loosened the Precise floor, allowed repeats,
      // etc.) instead of silently doing so. stagger-in gives it the same
      // gentle entrance as the cards so it doesn't just pop in.
      ...(note ? [el('p', { class: 'results-note stagger-in' }, [`ℹ️ ${note}`])] : []),
    ]);

    const grid =
      results.length > 0
        ? el('div', { class: 'results-grid' }, results.map((item, i) => buildCard(item, i)))
        : el('div', { class: 'state-message state-message-inline stagger-in' }, [
            el('h3', {}, ['Nothing new left for this exact combination']),
            el('p', {}, [
              'You\u2019ve rated your way through everything the live pool had. Try a fresh batch, or loosen the era, language, or mode filter for more variety.',
            ]),
            el('div', { class: 'state-message-actions' }, [
              el('button', { class: 'btn btn-primary', onclick: () => onDifferentPicks(differentBtn) }, [
                '🔀 Try different picks',
              ]),
              el('button', { class: 'btn btn-ghost', onclick: () => store.setScreen('quiz') }, ['← Adjust answers']),
            ]),
          ]);

    mount(screen, el('div', {}, [header, grid]));

    if (getLlmStatus() === 'ready') void refreshReasons(results, grid);
  }

  function llmButtonLabel(): string {
    const status = getLlmStatus();
    if (status === 'ready') return '✨ On-device AI: on';
    if (status === 'loading') return 'Loading on-device model…';
    if (status === 'error') return '⚠️ AI unavailable — retry';
    return '✨ Explain with on-device AI';
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
    const poster = buildPosterImage({
      src: posterUrl(item.posterPath, 'md'),
      alt: `${item.title} poster`,
      fallbackText: item.title.slice(0, 1),
    });
    const ratingBadge = item.externalRatings?.rottenTomatoes
      ? el('span', { class: 'badge badge-rt' }, [`🍅 ${item.externalRatings.rottenTomatoes}%`])
      : null;

    const card = el(
      'article',
      {
        class: 'result-card stagger-in',
        style: `--stagger: ${Math.min(index, 20)}`,
      },
      [
        el('div', { class: 'result-poster', onclick: () => openDetailModal(item) }, [
          poster,
          el('span', { class: 'result-poster-overlay' }, ['ℹ️ Details']),
        ]),
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
      ]
    );

    return card;
  }

  // ── Movie info modal — "check the info before watching" ─────────────
  function openDetailModal(item: ScoredItem) {
    const backdropSrc = backdropUrl(item.backdropPath) ?? posterUrl(item.posterPath, 'xl');

    const ratingsLine: string[] = [`⭐ ${item.voteAverage.toFixed(1)}/10 TMDB (${item.voteCount.toLocaleString()} votes)`];
    if (item.externalRatings?.rottenTomatoes !== undefined) ratingsLine.push(`🍅 ${item.externalRatings.rottenTomatoes}%`);
    if (item.externalRatings?.metacritic !== undefined) ratingsLine.push(`Ⓜ️ ${item.externalRatings.metacritic}`);
    if (item.externalRatings?.imdbRating !== undefined) ratingsLine.push(`IMDb ${item.externalRatings.imdbRating}`);

    const overlay = el('div', { class: 'modal-overlay', role: 'dialog', 'aria-modal': 'true' });
    const closeBtn = el('button', { class: 'modal-close', 'aria-label': 'Close' }, ['✕']);

    const hero = el('div', { class: 'modal-hero' }, [
      buildPosterImage({ src: backdropSrc, alt: `${item.title} backdrop`, fallbackText: item.title.slice(0, 1), eager: true }),
    ]);

    const modal = el('div', { class: 'modal-card' }, [
      closeBtn,
      hero,
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
    if (rateTimer !== null) window.clearTimeout(rateTimer);
  };
}
