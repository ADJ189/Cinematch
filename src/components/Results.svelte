<script lang="ts">
  import { onMount } from 'svelte';
  import { appState, goTo } from '../stores/appState.svelte.ts';
  import { RecommendationEngine } from '../lib/engine';
  import { fetchAiRecommendations } from '../lib/ai';
  import type { AiRecommendation, AiStatus } from '../lib/ai';
  import { posterUrl, backdropUrl, fetchLivePoster } from '../lib/tmdb';
  import type { ScoredItem } from '../lib/engine';

  // A unified shape that works for both AI and local results
  interface DisplayItem {
    title: string;
    year: number;
    type: 'movie' | 'series';
    matchPct: number;
    desc: string;
    reasons: string[];
    // Only present for catalog items (local engine)
    posterPath?: string;
    backdropPath?: string;
    rating?: number;
    tags?: string[];
    // Resolved poster URL (used for both modes)
    posterUrl?: string;
    backdropUrl?: string;
  }

  let top = $state<DisplayItem | null>(null);
  let rest = $state<DisplayItem[]>([]);
  let scoreDisplay = $state(0);
  let visible = $state(false);
  let aiStatus = $state<AiStatus>('idle');
  let aiError = $state<string | null>(null);

  // Convert a local ScoredItem to the unified DisplayItem shape
  function fromCatalog(item: ScoredItem): DisplayItem {
    return {
      title: item.title,
      year: item.year,
      type: item.type,
      matchPct: item.matchPct,
      desc: item.desc,
      reasons: item.reasons,
      posterPath: item.posterPath,
      backdropPath: item.backdropPath,
      rating: item.rating,
      tags: item.tags,
      posterUrl: posterUrl(item.posterPath, 'lg'),
      backdropUrl: backdropUrl(item.backdropPath),
    };
  }

  // Convert an AI recommendation to the unified DisplayItem shape
  // Posters are fetched live from TMDB by title search (best-effort)
  function fromAi(rec: AiRecommendation): DisplayItem {
    return {
      title: rec.title,
      year: rec.year,
      type: rec.type,
      matchPct: rec.matchPct,
      desc: rec.desc,
      reasons: rec.reasons,
      // Poster will be filled in async after mount
      posterUrl: undefined,
      backdropUrl: undefined,
    };
  }

  function animateScore(target: number) {
    const start = performance.now();
    const dur = 1100;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      const ease = 1 - Math.pow(1 - t, 3);
      scoreDisplay = Math.round(ease * target);
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  async function loadResults() {
    aiStatus = 'loading';

    // ── Try AI first ──────────────────────────────────────────────────────
    try {
      const aiRecs = await fetchAiRecommendations(appState.quizAnswers, appState.ratings);
      const items = aiRecs.map(fromAi);

      top = items[0];
      rest = items.slice(1, 5);
      aiStatus = 'success';

      // Fetch posters from TMDB search in the background (non-blocking)
      // AI items don't have tmdbIds so we use the posterPath fallback path;
      // for the top card only we attempt a live poster fetch by name.
      // Since the AI won't give us a TMDB ID we show a placeholder and
      // update reactively once it resolves.
      items.forEach(async (item, i) => {
        try {
          // Build a simple TMDB search URL using the title + year
          const query = encodeURIComponent(`${item.title} ${item.year}`);
          const searchType = item.type === 'series' ? 'tv' : 'movie';
          const res = await fetch(
            `https://api.themoviedb.org/3/search/${searchType}?query=${query}&api_key=&language=en-US`,
          );
          if (!res.ok) return;
          const data = await res.json() as {
            results?: Array<{ poster_path?: string; backdrop_path?: string }>;
          };
          const result = data.results?.[0];
          if (!result) return;
          const pUrl = result.poster_path
            ? `https://image.tmdb.org/t/p/w500${result.poster_path}`
            : undefined;
          const bUrl = result.backdrop_path
            ? `https://image.tmdb.org/t/p/w780${result.backdrop_path}`
            : undefined;
          // Update the reactive items in place
          if (i === 0 && top) {
            top = { ...top, posterUrl: pUrl, backdropUrl: bUrl };
          } else {
            const ri = i - 1;
            if (ri >= 0 && ri < rest.length) {
              rest = rest.map((r, idx) =>
                idx === ri ? { ...r, posterUrl: pUrl } : r
              );
            }
          }
        } catch {
          // Poster fetch failed — placeholder stays
        }
      });

    } catch (err) {
      // ── Fall back to local engine ───────────────────────────────────────
      aiStatus = 'fallback';
      aiError = err instanceof Error ? err.message : 'AI unavailable';

      const engine = new RecommendationEngine();
      engine.processQuiz(appState.quizAnswers);
      engine.processRatings(appState.ratings);
      const results = engine.getResults();

      top = fromCatalog(results[0]);
      rest = results.slice(1, 5).map(fromCatalog);
    }

    // ── Animate in ────────────────────────────────────────────────────────
    await new Promise(r => setTimeout(r, 400));
    visible = true;
    if (top) animateScore(top.matchPct ?? 0);
  }

  onMount(loadResults);

  function restart() {
    appState.quizAnswers = {};
    appState.ratings = {};
    goTo('landing', 'back');
  }
</script>

<section class="results">
  <header class="header">
    <span class="logo-sm">CineMatch</span>

    <!-- AI status badge -->
    {#if aiStatus === 'loading'}
      <span class="badge badge-loading">
        <span class="badge-dot pulse"></span>
        AI thinking…
      </span>
    {:else if aiStatus === 'success'}
      <span class="badge badge-ai">
        <span class="badge-dot"></span>
        Powered by Llama 3.1
      </span>
    {:else if aiStatus === 'fallback'}
      <span class="badge badge-local" title={aiError ?? ''}>
        Local engine
      </span>
    {/if}

    <button class="restart-btn" onclick={restart}>
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 7a5 5 0 1 0 1-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M3 4V1.5L1 4h2Z" fill="currentColor"/></svg>
      Start over
    </button>
  </header>

  {#if !top}
  <div class="loading">
    <div class="spinner"></div>
    <p>
      {#if aiStatus === 'loading'}
        Asking the AI…
      {:else}
        Finding your match…
      {/if}
    </p>
  </div>

  {:else}
  <!-- Backdrop -->
  <div class="backdrop-layer" aria-hidden="true">
    {#if top.backdropUrl}
      <img src={top.backdropUrl} alt="" class="backdrop-img" loading="eager" />
    {:else}
      <div class="backdrop-placeholder"></div>
    {/if}
    <div class="backdrop-fade"></div>
  </div>

  <div class="content" class:visible>
    <!-- Hero -->
    <div class="hero">
      <p class="eyebrow">
        <span class="eyebrow-dot"></span>
        Your perfect match
      </p>
      <h1 class="title">{top.title}</h1>
      <div class="meta-row">
        <span class="pill">{top.type === 'movie' ? '🎬 Movie' : '📺 Series'}</span>
        <span class="pill">{top.year}</span>
        {#if top.rating}
          <span class="pill">⭐ {top.rating}</span>
        {/if}
        {#if top.tags}
          {#each top.tags.slice(0,2) as tag}
            <span class="pill tag">{tag}</span>
          {/each}
        {/if}
      </div>
    </div>

    <!-- Main card -->
    <div class="main-card">
      <div class="card-poster">
        {#if top.posterUrl}
          <img src={top.posterUrl} alt={top.title} class="poster-img" />
        {:else}
          <div class="poster-placeholder">
            <span>{top.type === 'movie' ? '🎬' : '📺'}</span>
          </div>
        {/if}
      </div>
      <div class="card-body">
        <p class="desc">{top.desc}</p>

        <!-- Match score -->
        <div class="score-section">
          <div class="score-header">
            <span class="score-label">Match Score</span>
            <span class="score-num">{scoreDisplay}<span class="pct">%</span></span>
          </div>
          <div class="score-track">
            <div class="score-fill" style:width="{visible ? (top.matchPct ?? 0) + '%' : '0%'}"></div>
          </div>
        </div>

        <!-- Reasons -->
        {#if top.reasons.length}
        <div class="reasons">
          <p class="reasons-label">Why this pick</p>
          <ul>
            {#each top.reasons as reason, i}
            <li style:animation-delay="{600 + i*80}ms">{reason}</li>
            {/each}
          </ul>
        </div>
        {/if}

        <!-- Source attribution -->
        <div class="tmdb">
          {#if aiStatus === 'success'}
            <span>Recommendations by Llama 3.1 8B · Images</span>
          {:else}
            <span>Data &amp; images</span>
          {/if}
          <img
            src="https://www.themoviedb.org/assets/2/v4/logos/v2/blue_short-8e7b30f73a4020692ccca9c88bafe5dcb20f682cfcde4f289e2a97a87b5f7cc2.svg"
            alt="TMDB"
            class="tmdb-logo"
          />
        </div>
      </div>
    </div>

    <!-- Runner-ups -->
    <div class="also">
      <h2 class="also-title">You might also like</h2>
      <div class="also-grid">
        {#each rest as item, i}
        <div class="also-card" style:animation-delay="{700 + i * 80}ms">
          <div class="also-poster">
            {#if item.posterUrl}
              <img src={item.posterUrl} alt={item.title} loading="lazy" />
            {:else}
              <div class="also-poster-placeholder">{item.type === 'movie' ? '🎬' : '📺'}</div>
            {/if}
          </div>
          <div class="also-info">
            <p class="also-name">{item.title}</p>
            <p class="also-meta">{item.year} · {item.type === 'movie' ? 'Movie' : 'Series'}</p>
            <div class="also-bar-row">
              <div class="also-bar">
                <div class="also-fill" style:width="{item.matchPct ?? 0}%"></div>
              </div>
              <span class="also-pct">{item.matchPct}%</span>
            </div>
          </div>
        </div>
        {/each}
      </div>
    </div>

    <button class="try-again" onclick={restart}>
      Try again
    </button>
  </div>
  {/if}
</section>

<style>
  .results {
    position: relative; z-index: 2;
    min-height: 100svh;
    overflow-y: auto;
  }

  .header {
    display: flex; align-items: center; gap: 12px;
    padding: 18px 24px;
    position: sticky; top: 0; z-index: 20;
    background: rgba(0,0,0,0.7);
    backdrop-filter: blur(24px) saturate(180%);
    border-bottom: 1px solid rgba(255,255,255,0.06);
  }
  .logo-sm {
    font-family: 'Bricolage Grotesque', system-ui; font-size: 1.1rem; font-weight: 800;
    letter-spacing: -0.02em; color: #f5f5f7; margin-right: auto;
  }

  /* AI status badge */
  .badge {
    display: inline-flex; align-items: center; gap: 6px;
    border-radius: 100px; padding: 5px 11px;
    font-family: 'Plus Jakarta Sans', system-ui; font-size: 11px; font-weight: 600;
    letter-spacing: 0.02em; white-space: nowrap;
    border: 1px solid transparent;
  }
  .badge-loading {
    background: rgba(255,159,10,0.08); border-color: rgba(255,159,10,0.2);
    color: rgba(255,159,10,0.7);
  }
  .badge-ai {
    background: rgba(99,102,241,0.12); border-color: rgba(99,102,241,0.3);
    color: rgba(150,153,255,0.9);
  }
  .badge-local {
    background: rgba(255,255,255,0.05); border-color: rgba(255,255,255,0.1);
    color: rgba(255,255,255,0.3); cursor: help;
  }
  .badge-dot {
    width: 6px; height: 6px; border-radius: 50%; background: currentColor; flex-shrink: 0;
  }
  .badge-dot.pulse { animation: dotPulse 1.2s ease-in-out infinite; }
  @keyframes dotPulse { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }

  .restart-btn {
    display: inline-flex; align-items: center; gap: 6px;
    background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1);
    border-radius: 100px; padding: 8px 16px;
    font-family: 'Plus Jakarta Sans', system-ui; font-size: 13px; font-weight: 500;
    color: rgba(255,255,255,0.5); cursor: pointer;
    transition: background 0.15s, color 0.15s, transform 0.15s;
    flex-shrink: 0;
  }
  .restart-btn:hover { background: rgba(255,255,255,0.1); color: #f5f5f7; }
  .restart-btn:active { transform: scale(0.97); }

  /* Loading */
  .loading {
    flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 16px; min-height: calc(100svh - 60px);
    font-family: 'Plus Jakarta Sans', system-ui; font-size: 14px; color: rgba(255,255,255,0.3);
  }
  .spinner {
    width: 36px; height: 36px;
    border: 2px solid rgba(255,255,255,0.08);
    border-top-color: #FF9F0A;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* Backdrop */
  .backdrop-layer {
    position: fixed; top: 0; left: 0; right: 0; height: 60vh; z-index: -1; overflow: hidden;
  }
  .backdrop-img {
    width: 100%; height: 100%; object-fit: cover;
    filter: blur(40px) brightness(0.22) saturate(1.3);
    transform: scale(1.08);
  }
  .backdrop-placeholder {
    width: 100%; height: 100%;
    background: linear-gradient(135deg, #0d1117, #1a0a2e);
  }
  .backdrop-fade {
    position: absolute; inset: 0;
    background: linear-gradient(to bottom, transparent 20%, #000 100%);
  }

  /* Content */
  .content {
    max-width: 860px; margin: 0 auto;
    padding: 48px 20px 80px;
    opacity: 0; transform: translateY(20px);
    transition: opacity 0.5s cubic-bezier(0.22,1,0.36,1), transform 0.5s cubic-bezier(0.22,1,0.36,1);
  }
  .content.visible { opacity: 1; transform: translateY(0); }

  /* Hero */
  .hero { margin-bottom: 36px; }
  .eyebrow {
    display: inline-flex; align-items: center; gap: 8px;
    font-family: 'Plus Jakarta Sans', system-ui; font-size: 12px; font-weight: 500;
    letter-spacing: 0.08em; text-transform: uppercase;
    color: rgba(255,255,255,0.35); margin-bottom: 16px;
  }
  .eyebrow-dot { width: 6px; height: 6px; border-radius: 50%; background: #FF9F0A; box-shadow: 0 0 8px #FF9F0A; }
  .title {
    font-family: 'Bricolage Grotesque', system-ui;
    font-size: clamp(2.5rem, 7vw, 5.5rem);
    font-weight: 800; letter-spacing: -0.035em; line-height: 0.95;
    color: #f5f5f7; margin-bottom: 20px;
  }
  .meta-row { display: flex; flex-wrap: wrap; gap: 6px; }
  .pill {
    background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.1);
    border-radius: 100px; padding: 5px 12px;
    font-family: 'Plus Jakarta Sans', system-ui; font-size: 12px; color: rgba(255,255,255,0.45);
  }
  .pill.tag { border-color: rgba(255,159,10,0.25); color: rgba(255,159,10,0.7); }

  /* Main card */
  .main-card {
    display: grid; grid-template-columns: 180px 1fr; gap: 28px;
    background: rgba(14,14,18,0.88);
    backdrop-filter: blur(32px) saturate(180%);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 24px; padding: 24px;
    margin-bottom: 48px;
    box-shadow: 0 0 0 1px rgba(255,255,255,0.04), 0 4px 6px rgba(0,0,0,0.3), 0 32px 64px rgba(0,0,0,0.6);
  }
  @media (max-width: 560px) { .main-card { grid-template-columns: 1fr; } }

  .card-poster {
    border-radius: 14px; overflow: hidden;
    aspect-ratio: 2/3; background: rgba(255,255,255,0.04);
    box-shadow: 0 12px 40px rgba(0,0,0,0.6);
    transition: transform 0.4s cubic-bezier(0.22,1,0.36,1);
  }
  .card-poster:hover { transform: scale(1.03) rotate(-0.5deg); }
  .poster-img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .poster-placeholder {
    width: 100%; height: 100%;
    display: flex; align-items: center; justify-content: center;
    font-size: 3rem;
    background: linear-gradient(135deg, rgba(255,159,10,0.08), rgba(99,102,241,0.08));
  }

  .card-body { display: flex; flex-direction: column; gap: 20px; }
  .desc { font-family: 'Plus Jakarta Sans', system-ui; font-size: 0.95rem; color: rgba(255,255,255,0.45); line-height: 1.75; }

  /* Score */
  .score-header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px; }
  .score-label { font-family: 'Plus Jakarta Sans', system-ui; font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: rgba(255,255,255,0.25); }
  .score-num { font-family: 'Bricolage Grotesque', system-ui; font-size: 2.4rem; font-weight: 800; color: #FF9F0A; line-height: 1; letter-spacing: -0.03em; }
  .pct { font-size: 1.2rem; }
  .score-track { height: 4px; background: rgba(255,255,255,0.08); border-radius: 4px; overflow: hidden; }
  .score-fill {
    height: 100%;
    background: linear-gradient(90deg, #FF9F0A, #FFD60A);
    border-radius: 4px;
    transition: width 1.2s cubic-bezier(0.22,1,0.36,1);
    will-change: width;
  }

  /* Reasons */
  .reasons-label { font-family: 'Plus Jakarta Sans', system-ui; font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: rgba(255,255,255,0.2); margin-bottom: 10px; }
  .reasons ul { list-style: none; display: flex; flex-direction: column; gap: 6px; }
  .reasons li {
    display: flex; align-items: flex-start; gap: 8px;
    font-family: 'Plus Jakarta Sans', system-ui; font-size: 13px; color: rgba(255,255,255,0.45);
    animation: fadeUp 0.4s cubic-bezier(0.22,1,0.36,1) both;
  }
  @keyframes fadeUp { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }
  .reasons li::before { content: '✓'; color: #FF9F0A; font-size: 11px; flex-shrink: 0; padding-top: 1px; }

  /* TMDB */
  .tmdb { display: flex; align-items: center; gap: 8px; padding-top: 16px; border-top: 1px solid rgba(255,255,255,0.06); font-family: 'Plus Jakarta Sans', system-ui; font-size: 11px; color: rgba(255,255,255,0.2); }
  .tmdb-logo { height: 12px; opacity: 0.5; filter: brightness(10); }

  /* Also like */
  .also { margin-bottom: 40px; }
  .also-title { font-family: 'Bricolage Grotesque', system-ui; font-size: 1.5rem; font-weight: 700; letter-spacing: -0.025em; color: #f5f5f7; margin-bottom: 20px; }
  .also-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(175px, 1fr)); gap: 12px; }
  .also-card {
    background: rgba(14,14,18,0.8); backdrop-filter: blur(20px);
    border: 1px solid rgba(255,255,255,0.07); border-radius: 16px; overflow: hidden;
    transition: transform 0.25s cubic-bezier(0.22,1,0.36,1), border-color 0.2s;
    animation: fadeUp 0.4s cubic-bezier(0.22,1,0.36,1) both;
    cursor: default;
  }
  .also-card:hover { transform: translateY(-4px) scale(1.01); border-color: rgba(255,255,255,0.14); }
  .also-poster { aspect-ratio: 2/3; overflow: hidden; background: rgba(255,255,255,0.04); }
  .also-poster img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform 0.4s; }
  .also-card:hover .also-poster img { transform: scale(1.05); }
  .also-poster-placeholder {
    width: 100%; height: 100%;
    display: flex; align-items: center; justify-content: center;
    font-size: 2rem;
    background: linear-gradient(135deg, rgba(255,159,10,0.06), rgba(99,102,241,0.06));
  }
  .also-info { padding: 12px; }
  .also-name { font-family: 'Bricolage Grotesque', system-ui; font-size: 0.88rem; font-weight: 600; color: #f5f5f7; margin-bottom: 3px; }
  .also-meta { font-family: 'Plus Jakarta Sans', system-ui; font-size: 11px; color: rgba(255,255,255,0.25); margin-bottom: 8px; }
  .also-bar-row { display: flex; align-items: center; gap: 8px; }
  .also-bar { flex: 1; height: 2px; background: rgba(255,255,255,0.07); border-radius: 2px; overflow: hidden; }
  .also-fill { height: 100%; background: linear-gradient(90deg, #FF9F0A, #FFD60A); border-radius: 2px; }
  .also-pct { font-family: 'Plus Jakarta Sans', system-ui; font-size: 11px; font-weight: 600; color: #FF9F0A; white-space: nowrap; }

  /* Try again */
  .try-again {
    display: flex; margin: 0 auto;
    background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1);
    border-radius: 100px; padding: 14px 32px;
    font-family: 'Plus Jakarta Sans', system-ui; font-size: 15px; font-weight: 600;
    color: rgba(255,255,255,0.5); cursor: pointer;
    transition: background 0.15s, color 0.15s, transform 0.15s cubic-bezier(0.34,1.56,0.64,1);
  }
  .try-again:hover { background: rgba(255,255,255,0.1); color: #f5f5f7; transform: scale(1.03); }
  .try-again:active { transform: scale(0.97); }
</style>
