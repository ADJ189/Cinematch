<script lang="ts">
  import { goTo } from '../stores/appState.svelte.ts';

  function start() {
    goTo('quiz');
  }
</script>

<section class="landing">
  <div class="content">
    <div class="eyebrow">
      <span class="dot"></span>
      <span>Personalised recommendations</span>
    </div>

    <h1 class="headline">
      Find your<br/>
      <em>perfect</em> watch.
    </h1>

    <p class="subtext">
      Answer six questions. Rate a few titles.<br/>
      We'll find what you'll love next.
    </p>

    <button class="cta" onclick={start}>
      <span>Get Started</span>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>

    <div class="meta">
      <span>30 titles</span>
      <span class="sep">·</span>
      <span>2 min</span>
      <span class="sep">·</span>
      <span>TMDB data</span>
    </div>
  </div>

  <div class="scroll-hint" aria-hidden="true">
    <div class="scroll-line"></div>
    <span>Move cursor to interact</span>
  </div>
</section>

<style>
  .landing {
    position: relative; z-index: 2;
    min-height: 100svh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 0 24px;
    text-align: center;
  }

  .content {
    max-width: 600px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0;
  }

  .eyebrow {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 100px;
    padding: 6px 14px 6px 10px;
    font-size: 12px;
    font-weight: 500;
    letter-spacing: 0.02em;
    color: rgba(255,255,255,0.5);
    margin-bottom: 32px;
    backdrop-filter: blur(12px);
  }
  .dot {
    width: 6px; height: 6px;
    border-radius: 50%;
    background: #FF9F0A;
    box-shadow: 0 0 8px #FF9F0A;
    animation: pulse 2s ease-in-out infinite;
  }
  @keyframes pulse {
    0%,100% { opacity: 1; transform: scale(1); }
    50%      { opacity: 0.6; transform: scale(0.85); }
  }

  .headline {
    font-family: 'Bricolage Grotesque', system-ui, sans-serif;
    font-size: clamp(3.2rem, 9vw, 7.5rem);
    font-weight: 800;
    line-height: 0.95;
    letter-spacing: -0.03em;
    color: #f5f5f7;
    margin-bottom: 28px;
  }
  .headline em {
    font-style: normal;
    background: linear-gradient(135deg, #FF9F0A 0%, #FFD60A 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  .subtext {
    font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
    font-size: clamp(1rem, 2.5vw, 1.15rem);
    font-weight: 300;
    line-height: 1.7;
    color: rgba(255,255,255,0.45);
    margin-bottom: 40px;
  }

  .cta {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    background: #FF9F0A;
    color: #000;
    border: none;
    border-radius: 100px;
    padding: 16px 32px;
    font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
    font-size: 15px;
    font-weight: 700;
    letter-spacing: 0.01em;
    cursor: pointer;
    transition: transform 0.2s cubic-bezier(0.34,1.56,0.64,1), box-shadow 0.2s ease;
    margin-bottom: 24px;
    will-change: transform;
  }
  .cta:hover {
    transform: scale(1.04) translateY(-1px);
    box-shadow: 0 8px 32px rgba(255,159,10,0.45);
  }
  .cta:active { transform: scale(0.97); }

  .meta {
    display: flex;
    align-items: center;
    gap: 8px;
    font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
    font-size: 12px;
    color: rgba(255,255,255,0.2);
    font-weight: 400;
  }
  .sep { opacity: 0.3; }

  .scroll-hint {
    position: absolute;
    bottom: 32px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    color: rgba(255,255,255,0.15);
    font-size: 11px;
    font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
    letter-spacing: 0.04em;
  }
  .scroll-line {
    width: 1px; height: 40px;
    background: linear-gradient(to bottom, transparent, rgba(255,255,255,0.15));
    animation: line-grow 2s ease-in-out infinite;
  }
  @keyframes line-grow {
    0%,100% { transform: scaleY(0.4); opacity: 0.4; }
    50%      { transform: scaleY(1);   opacity: 1; }
  }
</style>
