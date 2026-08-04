// src/screens/search.ts
//
// Search a specific movie/show and see what's actually similar to it —
// deliberately a different data source than the quiz-driven results
// screen. results.ts scores candidates against *this user's* stated
// quiz preferences; that's the wrong model for "what's similar to this
// one title", since people's taste isn't static from session to session
// and a single title's similarity is better answered by TMDB's own
// recommendation data (collaborative filtering — what people who
// engaged with this title also engaged with) than by re-running our
// genre/vibe heuristic on it. See tmdb.ts's getSimilarTitles() for the
// detail.

import { buildPosterImage, el, mount } from '../lib/dom';
import { ICON } from '../lib/icons';
import { enableLocalAi, explainPick, getLlmStatus, getLlmStatusDetail } from '../lib/llm';
import { isInWatchlist, recordRating, toggleWatchlist } from '../lib/profile';
import { mountProviders } from '../lib/providers-ui';
import { store } from '../lib/store';
import { backdropUrl, getSimilarTitles, posterUrl, searchMulti, tmdbDetailsUrl } from '../lib/tmdb';
import type { CatalogItem, RatingValue, ScoredItem } from '../lib/types';

const SEARCH_DEBOUNCE_MS = 350;
const AI_LIMIT = 8;

/** Turns a plain CatalogItem into the ScoredItem shape the shared card
 * styling expects, without pretending TMDB's similarity data is a quiz
 * match score. `matchPct` here is repurposed as a rough "how many genres
 * this shares with the title you searched" indicator — shown in smaller,
 * quieter type than the results screen's quiz match% (see search.css) so
 * it doesn't read as the same kind of number. */
function toSimilarItem(item: CatalogItem, source: CatalogItem): ScoredItem {
  const shared = item.genres.filter((g) => source.genres.includes(g));
  const reasons: string[] = [];
  if (shared.length > 0) reasons.push(`Shares ${shared.join(', ')} with ${source.title}`);
  if (item.voteAverage >= 7) reasons.push(`Well-rated: ${item.voteAverage.toFixed(1)}/10 on TMDB`);
  if (reasons.length === 0) reasons.push(`From TMDB's own recommendations for ${source.title}`);
  const overlapPct = source.genres.length > 0 ? Math.round((shared.length / source.genres.length) * 100) : 0;
  return { ...item, matchPct: overlapPct, reasons };
}

export function renderSearch(root: HTMLElement): () => void {
  let cancelled = false;
  let debounceTimer: number | null = null;
  let searchToken = 0;
  let selected: CatalogItem | null = null;
  let similarItems: ScoredItem[] = [];
  const resultRatings = new Map<number, RatingValue>();

  const screen = el('div', { class: 'screen search-screen' });
  mount(root, screen);
  draw();

  function draw() {
    const input = el('input', {
      class: 'search-input',
      type: 'search',
      placeholder: 'Search a movie or show you already know…',
      autocomplete: 'off',
      'aria-label': 'Search for a title',
    }) as HTMLInputElement;
    input.addEventListener('input', () => {
      if (debounceTimer !== null) window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(() => void runSearch(input.value), SEARCH_DEBOUNCE_MS);
    });

    const searchIconWrap = el('span', { class: 'icon-inline', style: 'width:18px;height:18px' });
    searchIconWrap.innerHTML = `<svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="8.6" cy="8.6" r="5.6" stroke="currentColor" stroke-width="1.6"/><path d="M17 17l-4-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;

    const resultsList = el('div', { class: 'search-results-list' });
    const detailHost = el('div', { class: 'search-detail-host' });

    const header = el('div', { class: 'search-header' }, [
      (() => {
        const backBtn = el('button', { class: 'btn btn-ghost toolbar-btn', onclick: () => store.setScreen('landing') });
        backBtn.innerHTML = `<span class="icon-inline" style="width:14px;height:14px">${ICON.chevronLeft}</span> Back`;
        return backBtn;
      })(),
      el('h2', {}, ['Search for a title']),
      el('p', { class: 'search-sub' }, [
        'Find a movie or show you already like, and see what\u2019s actually similar — pulled straight from TMDB\u2019s own recommendation data, not re-run through your quiz answers, since taste shifts session to session.',
      ]),
      el('div', { class: 'search-bar' }, [searchIconWrap, input]),
      resultsList,
    ]);

    mount(screen, el('div', {}, [header, detailHost]));
    input.focus();

    async function runSearch(query: string) {
      const token = ++searchToken;
      const trimmed = query.trim();
      if (trimmed.length < 2) {
        resultsList.replaceChildren();
        return;
      }
      resultsList.replaceChildren(el('p', { class: 'search-loading' }, ['Searching…']));
      try {
        const matches = await searchMulti(trimmed);
        if (cancelled || token !== searchToken) return;
        if (matches.length === 0) {
          resultsList.replaceChildren(el('p', { class: 'search-loading' }, ['No matches — try a different spelling.']));
          return;
        }
        resultsList.replaceChildren(
          ...matches.slice(0, 8).map((m) =>
            el(
              'button',
              {
                class: 'search-result-row',
                onclick: () => {
                  resultsList.replaceChildren();
                  input.value = '';
                  void selectTitle(m, detailHost);
                },
              },
              [
                buildPosterImage({ src: posterUrl(m.posterPath, 'xs'), alt: '', fallbackText: m.title.slice(0, 1) }),
                el('span', { class: 'search-result-meta' }, [
                  el('span', { class: 'search-result-title' }, [`${m.title} (${m.year})`]),
                  el('span', { class: 'search-result-type' }, [m.type === 'series' ? 'TV series' : 'Movie']),
                ]),
              ]
            )
          )
        );
      } catch {
        if (cancelled || token !== searchToken) return;
        resultsList.replaceChildren(el('p', { class: 'search-loading' }, ['Search failed — check your connection and try again.']));
      }
    }
  }

  async function selectTitle(item: CatalogItem, host: HTMLElement) {
    selected = item;
    resultRatings.clear();
    host.replaceChildren(el('p', { class: 'search-loading' }, [`Finding titles similar to ${item.title}…`]));

    const similar = await getSimilarTitles(item.id, item.tmdbType).catch(() => []);
    if (cancelled || selected !== item) return;

    similarItems = similar.slice(0, 24).map((s) => toSimilarItem(s, item));
    drawDetail(item, similarItems, host);
  }

  function drawDetail(source: CatalogItem, results: ScoredItem[], host: HTMLElement) {
    const backdrop = backdropUrl(source.backdropPath);

    const hero = el(
      'div',
      { class: 'search-hero', style: backdrop ? `--hero-bg: url('${backdrop}')` : '' },
      [
        el('div', { class: 'search-hero-inner' }, [
          buildPosterImage({ src: posterUrl(source.posterPath, 'md'), alt: `${source.title} poster`, fallbackText: source.title.slice(0, 1) }),
          el('div', { class: 'search-hero-info' }, [
            el('h3', {}, [`${source.title} (${source.year})`]),
            el('p', { class: 'search-hero-overview' }, [source.overview || 'No synopsis available.']),
            el(
              'a',
              { class: 'btn btn-ghost', href: tmdbDetailsUrl(source.id, source.tmdbType), target: '_blank', rel: 'noopener' },
              ['View on TMDB ↗']
            ),
            (() => {
              const providersHost = el('div', { class: 'search-hero-providers' });
              mountProviders(providersHost, source.id, source.tmdbType);
              return providersHost;
            })(),
          ]),
        ]),
      ]
    );

    const aiBtn = el('button', { class: 'btn btn-ghost toolbar-btn' }, [llmButtonLabel()]);
    aiBtn.addEventListener('click', () => toggleLocalAi(aiBtn, results, source));

    const grid = el(
      'div',
      { class: 'results-grid' },
      results.map((item, i) => buildCard(item, i))
    );

    const section = el('div', { class: 'search-similar-section' }, [
      el('div', { class: 'search-similar-header' }, [
        el('h3', {}, [`Similar to ${source.title}`]),
        aiBtn,
      ]),
      results.length > 0
        ? grid
        : el('p', { class: 'search-loading' }, ['TMDB doesn\u2019t have similar-title data for this one yet.']),
    ]);

    host.replaceChildren(hero, section);
    if (getLlmStatus() === 'ready') void refreshReasons(results, grid, source);
  }

  function llmButtonLabel(): string {
    const status = getLlmStatus();
    if (status === 'ready') return '✨ On-device AI: on';
    if (status === 'loading') return 'Loading on-device model…';
    if (status === 'error') return '⚠️ AI unavailable — retry';
    return '✨ Summarize with on-device AI';
  }

  async function toggleLocalAi(btn: HTMLElement, results: ScoredItem[], source: CatalogItem) {
    if (getLlmStatus() === 'ready') return;
    btn.setAttribute('disabled', '');
    btn.textContent = 'Loading on-device model…';
    try {
      await enableLocalAi((pct) => {
        btn.textContent = `Loading on-device model… ${pct}%`;
      });
      btn.textContent = llmButtonLabel();
      const grid = screen.querySelector<HTMLElement>('.search-similar-section .results-grid');
      if (grid) await refreshReasons(results, grid, source);
    } catch {
      btn.textContent = llmButtonLabel();
      btn.title = getLlmStatusDetail();
    } finally {
      btn.removeAttribute('disabled');
    }
  }

  async function refreshReasons(results: ScoredItem[], grid: HTMLElement, source: CatalogItem) {
    const summary = `titles similar to "${source.title}" (${source.genres.join(', ') || 'no genre data'})`;
    const cards = grid.querySelectorAll<HTMLElement>('.result-reasons');
    await Promise.all(
      results.slice(0, AI_LIMIT).map(async (item, i) => {
        const sentence = await explainPick(item, summary);
        const listEl = cards[i];
        if (listEl) listEl.replaceChildren(el('li', { class: 'ai-reason' }, [sentence]));
      })
    );
  }

  function buildWatchlistButton(item: ScoredItem): HTMLElement {
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

  function buildCard(item: ScoredItem, index: number): HTMLElement {
    const poster = buildPosterImage({
      src: posterUrl(item.posterPath, 'md'),
      alt: `${item.title} poster`,
      fallbackText: item.title.slice(0, 1),
    });

    const previewParts = [{ svg: ICON.starFilled, label: item.voteAverage.toFixed(1) }];

    const card = el('article', { class: 'result-card stagger-in', style: `--stagger: ${Math.min(index, 20)}` }, [
      el(
        'div',
        {
          class: 'result-poster',
          onclick: () => {
            const host = screen.querySelector<HTMLElement>('.search-detail-host');
            if (host) void selectTitle(item, host);
          },
        },
        [
          poster,
          buildWatchlistButton(item),
          el('div', { class: 'result-hover-preview' }, [
            el('p', { class: 'hover-preview-overview' }, [item.overview || 'No synopsis available.']),
            (() => {
              const p = el('p', { class: 'hover-preview-ratings' });
              p.innerHTML = previewParts
                .map((pt) => `<span class="icon-inline" style="width:12px;height:12px">${pt.svg}</span> ${pt.label}`)
                .join(' ');
              return p;
            })(),
            (() => {
              const span = el('span', { class: 'hover-preview-cta' });
              span.innerHTML = `<span class="icon-inline" style="width:12px;height:12px">${ICON.arrowUpRight}</span> See what's similar to this`;
              return span;
            })(),
          ]),
        ]
      ),
      el('div', { class: 'result-body' }, [
        el('div', { class: 'result-match search-overlap' }, [`${item.matchPct}% genre overlap`]),
        el('h3', { class: 'result-title' }, [`${item.title} (${item.year})`]),
        el(
          'ul',
          { class: 'result-reasons' },
          item.reasons.map((r) => el('li', {}, [r]))
        ),
        buildStarRow(item.id, resultRatings.get(item.id), (v) => {
          resultRatings.set(item.id, v);
          recordRating(item, v, 'result');
          screen.querySelectorAll<HTMLElement>(`[data-item="${item.id}"]`).forEach((row) => {
            row.querySelectorAll<HTMLButtonElement>('.star').forEach((s, i) => s.classList.toggle('filled', i < v));
          });
        }),
      ]),
    ]);
    return card;
  }

  function buildStarRow(id: number, current: RatingValue | undefined, onRate: (v: RatingValue) => void): HTMLElement {
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

  return () => {
    cancelled = true;
    if (debounceTimer !== null) window.clearTimeout(debounceTimer);
  };
}
