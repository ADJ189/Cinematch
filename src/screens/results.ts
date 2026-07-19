import { SEED_SIGNALS, RATING_SEEDS } from '../data/rating-seeds';
import { RecommendationEngine } from '../lib/engine';
import { el, mount } from '../lib/dom';
import { store } from '../lib/store';
import { discoverCandidates, isTmdbConfigured, posterUrl } from '../lib/tmdb';
import { fetchExternalRatings, isOmdbConfigured } from '../lib/omdb';
import { enableLocalAi, explainPick, getLlmStatus } from '../lib/llm';
import type { ScoredItem } from '../lib/types';

function summarizeQuiz(state: ReturnType<typeof store.getState>): string {
  const { mood, vibe, era, company } = state.quizAnswers;
  return [mood, vibe, era !== 'any' ? era : null, company]
    .filter(Boolean)
    .join(', ') || 'no strong preference stated';
}

export function renderResults(root: HTMLElement): () => void {
  let cancelled = false;

  const screen = el('div', { class: 'screen results' });
  mount(root, screen);
  drawLoading();
  run();

  async function run() {
    if (!isTmdbConfigured) {
      drawConfigError();
      return;
    }

    const { quizAnswers, ratings } = store.getState();

    try {
      const candidates = await discoverCandidates({
        mood: quizAnswers.mood,
        vibe: quizAnswers.vibe,
        era: quizAnswers.era,
        format: quizAnswers.format,
        language: quizAnswers.language,
      });
      if (cancelled) return;

      const engine = new RecommendationEngine();
      engine.processQuiz(quizAnswers);
      engine.processRatings(ratings, RATING_SEEDS, SEED_SIGNALS);

      let results = engine.getResults(candidates, SEED_SIGNALS).slice(0, 24);

      // Enrich only the top slice with OMDb secondary ratings — keeps
      // network calls bounded regardless of pool size.
      if (isOmdbConfigured) {
        const top = results.slice(0, 8);
        await Promise.all(
          top.map(async (item) => {
            const ext = await fetchExternalRatings(item.title, item.year);
            if (ext) item.externalRatings = ext;
          })
        );
        // Re-score with external ratings folded in, keep the rest as-is.
        const rescored = engine.getResults([...top, ...results.slice(8)], SEED_SIGNALS);
        results = rescored;
      }

      if (cancelled) return;
      store.setResults(results);
      draw(results);
    } catch (err) {
      if (cancelled) return;
      const message = err instanceof Error ? err.message : 'Something went wrong fetching results.';
      store.setError(message);
      drawError(message);
    }
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

  function draw(results: ScoredItem[]) {
    if (results.length === 0) {
      mount(
        screen,
        el('div', { class: 'state-message' }, [
          el('h2', {}, ['No matches for this combination']),
          el('p', {}, ['Try loosening the era or language filter.']),
          el('button', { class: 'btn btn-ghost', onclick: () => store.setScreen('quiz') }, ['← Adjust answers']),
        ])
      );
      return;
    }

    const aiBtn = el(
      'button',
      { class: 'btn btn-ghost' },
      [getLlmStatus() === 'ready' ? 'On-device AI: on' : 'Explain picks with on-device AI']
    );
    aiBtn.addEventListener('click', () => toggleLocalAi(aiBtn, results));

    const header = el('div', { class: 'results-header' }, [
      el('h2', {}, ['Your matches']),
      el('p', {}, [`${results.length} titles, ranked and scored against your answers.`]),
      el('div', { class: 'results-actions' }, [aiBtn, el('button', { class: 'btn btn-ghost', onclick: restart }, ['Start over'])]),
    ]);

    const grid = el(
      'div',
      { class: 'results-grid' },
      results.map((item) => buildCard(item))
    );

    mount(screen, el('div', {}, [header, grid]));

    if (getLlmStatus() === 'ready') void refreshReasons(results, grid);
  }

  async function toggleLocalAi(btn: HTMLElement, results: ScoredItem[]) {
    if (getLlmStatus() === 'ready') return;
    btn.textContent = 'Loading on-device model…';
    btn.setAttribute('disabled', '');
    try {
      await enableLocalAi((pct) => {
        btn.textContent = `Loading on-device model… ${pct}%`;
      });
      btn.textContent = 'On-device AI: on';
      const grid = screen.querySelector<HTMLElement>('.results-grid');
      if (grid) await refreshReasons(results, grid);
    } catch {
      btn.textContent = 'On-device AI unavailable on this device';
    } finally {
      btn.removeAttribute('disabled');
    }
  }

  async function refreshReasons(results: ScoredItem[], grid: HTMLElement) {
    const summary = summarizeQuiz(store.getState());
    const cards = grid.querySelectorAll<HTMLElement>('.result-reasons');
    await Promise.all(
      results.slice(0, 8).map(async (item, i) => {
        const sentence = await explainPick(item, summary);
        const listEl = cards[i];
        if (listEl) listEl.replaceChildren(el('li', { class: 'ai-reason' }, [sentence]));
      })
    );
  }

  function buildCard(item: ScoredItem): HTMLElement {
    const poster = posterUrl(item.posterPath, 'md');
    const ratingBadge = item.externalRatings?.rottenTomatoes
      ? el('span', { class: 'badge badge-rt' }, [`🍅 ${item.externalRatings.rottenTomatoes}%`])
      : null;

    return el('article', { class: 'result-card' }, [
      el('div', {
        class: 'result-poster',
        style: poster ? `background-image: url(${poster})` : undefined,
      }, poster ? [] : [el('span', { class: 'poster-fallback' }, [item.title.slice(0, 1)])]),
      el('div', { class: 'result-body' }, [
        el('div', { class: 'result-match' }, [`${item.matchPct}% match`]),
        el('h3', { class: 'result-title' }, [`${item.title} (${item.year})`]),
        ...(ratingBadge ? [ratingBadge] : []),
        el(
          'ul',
          { class: 'result-reasons' },
          item.reasons.map((r) => el('li', {}, [r]))
        ),
      ]),
    ]);
  }

  function restart() {
    store.reset();
    store.setScreen('landing');
  }

  void getLlmStatus; // reserved: local-AI reason rewriting hooks in here once enabled from settings

  return () => {
    cancelled = true;
  };
}
