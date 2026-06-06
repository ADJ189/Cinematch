<script lang="ts">
  import { appState, goTo } from '../stores/appState.svelte.ts';
  import { RATING_POOL } from '../lib/data';
  import { posterUrl } from '../lib/tmdb';
  import type { RatingItem } from '../lib/types';

  // Baked-in TMDB poster paths — served from TMDB CDN, no API key needed
  const POSTER_PATHS: Record<number, string> = {
    101: '/qJ2tW6WMUDux911r6m7haRef0WH.jpg',
    102: '/d5iIlFn5s0ImszYzBPb8JPIfbXD.jpg',
    103: '/or06FN3Dka5tukK1e9sl16pB3iy.jpg',
    104: '/49WJfeN0moxb9IPfGn8AIqMGskD.jpg',
    105: '/1XS1oqL89opfnbLl8WnZY1O1uJx.jpg',
    106: '/f89U3ADr1oiB1s9GkdPOEpXUk5H.jpg',
    107: '/dDlEmu3EZ0Pgg93K2SVNLCjCSvE.jpg',
    108: '/uDO8zWDhfWwoFdKS4fzkUJt0Rf0.jpg',
    109: '/rplLJ2hPcOQmkFhTqUte0MkEaO2.jpg',
    110: '/f496cm9enuEsZkSPzCwnTESEK5s.jpg',
    111: '/9xjZS2rlVxm8SFx8kPC3aIGCOYQ.jpg',
    112: '/6oom5QYQ2yQTMJIbnvbkBL9cHo6.jpg',
    113: '/sF1U4EUQS8YHUYjNl3pMGNIQyr0.jpg',
    114: '/arw2vcBveWOVZr6pxd9XTd1TdQa.jpg',
    115: '/2iGLXCPGRPgE4MCpN8ojJRiLpjG.jpg',
  };

  const pool: RatingItem[] = [...RATING_POOL]
    .sort(() => Math.random() - 0.5)
    .slice(0, 6);

  let phase = $state<'intro' | 'rating'>('intro');
  let index = $state(0);
  let hoverStar = $state(0);
  let ratedStar = $state(0);
  let leaving = $state(false);

  const item = $derived(pool[index]);
  const progress = $derived((index / pool.length) * 100);
  const LABELS = ['', "Didn't like it", "It was okay", "Liked it", "Really liked it", "Loved it ✨"];

  function startRating() { phase = 'rating'; }

  async function rate(val: number) {
    if (val > 0) appState.ratings[item.id] = val;
    ratedStar = val;
    await new Promise(r => setTimeout(r, 350));
    if (index + 1 < pool.length) {
      leaving = true;
      await new Promise(r => setTimeout(r, 130));
      index++;
      ratedStar = 0;
      hoverStar = 0;
      leaving = false;
    } else {
      goTo('results');
    }
  }

  function skip() { rate(0); }
</script>

<section class="rating-screen">
  <header class="header">
    <span class="logo-sm">CineMatch</span>
    {#if phase === 'rating'}
    <div class="prog-wrap">
      <div class="prog-track"><div class="prog-fill" style:width="{progress}%"></div></div>
      <span class="prog-txt">{index + 1} / {pool.length}</span>
    </div>
    {/if}
  </header>

  {#if phase === 'intro'}
    <div class="intro">
      <span class="intro-icon" aria-hidden="true">🎯</span>
      <h2>Calibrate<br/><span class="accent">your taste</span></h2>
      <p>Rate titles you've seen so we can fine-tune your match. Skip anything you haven't watched.</p>
      <button class="cta-btn" onclick={startRating}>
        Start Rating
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 7h10M8 3l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
    </div>

  {:else}
    {#key index}
    <div class="card-wrap" class:leaving>
      <div class="rating-card">
        <button class="skip-btn" onclick={skip}>Skip →</button>

        <div class="poster-frame">
          <img
            src={posterUrl(POSTER_PATHS[item.id] ?? '/placeholder.jpg', 'md')}
            alt={item.title}
            class="poster-img"
          />
        </div>

        <h3 class="title">{item.title}</h3>
        <p class="year">{item.year}</p>
        <p class="prompt">How would you rate it?</p>

        <div class="stars" role="group" aria-label="Rating for {item.title}">
          {#each [1, 2, 3, 4, 5] as n}
            <button
              class="star"
              class:lit={n <= (ratedStar || hoverStar)}
              class:locked={ratedStar > 0}
              onmouseenter={() => { if (!ratedStar) hoverStar = n; }}
              onmouseleave={() => { if (!ratedStar) hoverStar = 0; }}
              onclick={() => rate(n)}
              aria-label="{n} star{n > 1 ? 's' : ''}"
            >★</button>
          {/each}
        </div>
        <p class="star-label" aria-live="polite">
          {ratedStar ? LABELS[ratedStar] : hoverStar ? LABELS[hoverStar] : 'Tap to rate'}
        </p>
      </div>
    </div>
    {/key}
  {/if}
</section>

<style>
  .rating-screen {
    position: relative; z-index: 2;
    min-height: 100svh; display: flex; flex-direction: column;
  }
  .header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 18px 24px; gap: 16px;
    background: rgba(0,0,0,0.6);
    backdrop-filter: blur(24px) saturate(180%);
    border-bottom: 1px solid rgba(255,255,255,0.06);
    position: sticky; top: 0; z-index: 10;
  }
  .logo-sm {
    font-family: 'Bricolage Grotesque', system-ui;
    font-size: 1.1rem; font-weight: 800;
    letter-spacing: -0.02em; color: #f5f5f7; white-space: nowrap;
  }
  .prog-wrap { display: flex; align-items: center; gap: 10px; flex: 1; max-width: 260px; }
  .prog-track { flex: 1; height: 2px; background: rgba(255,255,255,0.08); border-radius: 2px; overflow: hidden; }
  .prog-fill {
    height: 100%;
    background: linear-gradient(90deg, #FF9F0A, #FFD60A);
    border-radius: 2px;
    transition: width 0.5s cubic-bezier(0.4,0,0.2,1);
    will-change: width;
  }
  .prog-txt { font-family: 'Plus Jakarta Sans', system-ui; font-size: 12px; font-weight: 600; color: rgba(255,255,255,0.3); white-space: nowrap; }

  /* Intro */
  .intro {
    flex: 1; display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    padding: 48px 24px; text-align: center;
    animation: fadeUp 0.5s cubic-bezier(0.22,1,0.36,1) both;
  }
  @keyframes fadeUp { from { opacity:0; transform:translateY(20px); } to { opacity:1; transform:translateY(0); } }
  .intro-icon { font-size: 3.5rem; margin-bottom: 24px; display: block; animation: floatIcon 5s ease-in-out infinite; }
  @keyframes floatIcon { 0%,100% { transform:translateY(0); } 50% { transform:translateY(-10px); } }
  .intro h2 {
    font-family: 'Bricolage Grotesque', system-ui;
    font-size: clamp(2rem,5vw,3rem); font-weight: 800;
    letter-spacing: -0.03em; line-height: 1.1; color: #f5f5f7; margin-bottom: 16px;
  }
  .accent {
    background: linear-gradient(135deg, #FF9F0A, #FFD60A);
    -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
  }
  .intro p {
    font-family: 'Plus Jakarta Sans', system-ui;
    font-size: 1rem; color: rgba(255,255,255,0.4);
    max-width: 360px; line-height: 1.75; margin-bottom: 36px;
  }
  .cta-btn {
    display: inline-flex; align-items: center; gap: 10px;
    background: #FF9F0A; color: #000; border: none;
    border-radius: 100px; padding: 14px 28px;
    font-family: 'Plus Jakarta Sans', system-ui; font-size: 15px; font-weight: 700; cursor: pointer;
    transition: transform 0.2s cubic-bezier(0.34,1.56,0.64,1), box-shadow 0.2s;
  }
  .cta-btn:hover { transform: scale(1.04) translateY(-1px); box-shadow: 0 8px 32px rgba(255,159,10,0.4); }
  .cta-btn:active { transform: scale(0.97); }

  /* Card transitions */
  .card-wrap {
    flex: 1; display: flex; align-items: center; justify-content: center;
    padding: 32px 20px;
    animation: cardIn 0.4s cubic-bezier(0.22,1,0.36,1) both;
  }
  .card-wrap.leaving { animation: cardOut 0.13s ease-in both; }
  @keyframes cardIn { from { opacity:0; transform:scale(0.93) translateY(16px); } to { opacity:1; transform:scale(1) translateY(0); } }
  @keyframes cardOut { to { opacity:0; transform:scale(0.94) translateY(-10px); } }

  /* Card */
  .rating-card {
    max-width: 340px; width: 100%;
    background: rgba(14,14,18,0.92);
    backdrop-filter: blur(32px) saturate(180%);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 24px; padding: 24px 22px 26px;
    text-align: center; position: relative;
    box-shadow: 0 0 0 1px rgba(255,255,255,0.04), 0 4px 6px rgba(0,0,0,0.3), 0 24px 48px rgba(0,0,0,0.6);
  }
  .skip-btn {
    position: absolute; top: 14px; right: 14px;
    background: none; border: 1px solid rgba(255,255,255,0.08); border-radius: 100px;
    padding: 5px 12px; font-size: 11px;
    font-family: 'Plus Jakarta Sans', system-ui;
    color: rgba(255,255,255,0.25); cursor: pointer;
    transition: border-color 0.15s, color 0.15s;
  }
  .skip-btn:hover { border-color: rgba(255,255,255,0.2); color: rgba(255,255,255,0.5); }

  .poster-frame {
    width: 116px; height: 174px; margin: 0 auto 20px;
    border-radius: 12px; overflow: hidden;
    background: rgba(255,255,255,0.04);
    box-shadow: 0 12px 36px rgba(0,0,0,0.55);
  }
  .poster-img { width: 100%; height: 100%; object-fit: cover; display: block; }

  .title {
    font-family: 'Bricolage Grotesque', system-ui;
    font-size: 1.45rem; font-weight: 700; letter-spacing: -0.02em; color: #f5f5f7; margin-bottom: 4px;
  }
  .year {
    font-family: 'Plus Jakarta Sans', system-ui;
    font-size: 12px; color: rgba(255,255,255,0.22); margin-bottom: 22px; letter-spacing: 0.04em;
  }
  .prompt { font-family: 'Plus Jakarta Sans', system-ui; font-size: 13px; color: rgba(255,255,255,0.32); margin-bottom: 14px; }

  .stars { display: flex; justify-content: center; gap: 4px; margin-bottom: 10px; }
  .star {
    background: none; border: none; font-size: 2.1rem; cursor: pointer;
    color: rgba(255,255,255,0.1);
    transition: color 0.1s, transform 0.18s cubic-bezier(0.34,1.56,0.64,1);
    line-height: 1; padding: 4px 2px; will-change: transform;
  }
  .star.lit { color: #FF9F0A; text-shadow: 0 0 18px rgba(255,159,10,0.65); }
  .star:not(.locked):hover { transform: scale(1.35); }
  .star.locked { pointer-events: none; }
  .star-label {
    font-family: 'Plus Jakarta Sans', system-ui; font-size: 12px;
    color: rgba(255,255,255,0.3); min-height: 1.4em; letter-spacing: 0.01em;
  }
</style>
