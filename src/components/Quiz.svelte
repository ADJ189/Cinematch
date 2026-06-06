<script lang="ts">
  import { appState, goTo } from '../stores/appState.svelte.ts';
  import { QUIZ_QUESTIONS } from '../lib/data';

  let index = $state(0);
  let selected = $state<string | null>(null);
  let entering = $state(true);

  const question = $derived(QUIZ_QUESTIONS[index]);
  const progress = $derived((index / QUIZ_QUESTIONS.length) * 100);

  async function pick(value: string) {
    if (selected) return;
    selected = value;

    await new Promise(r => setTimeout(r, 220));

    // Store answer
    (appState.quizAnswers as Record<string, string>)[question.id] = value;

    if (index + 1 < QUIZ_QUESTIONS.length) {
      entering = false;
      await new Promise(r => setTimeout(r, 60));
      index++;
      selected = null;
      entering = true;
    } else {
      goTo('rating');
    }
  }

  function back() {
    if (index === 0) { goTo('landing', 'back'); return; }
    index--;
    selected = null;
    entering = true;
  }
</script>

<section class="quiz">
  <!-- Header -->
  <header class="header">
    <button class="back-btn" onclick={back} aria-label="Back">
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <path d="M11 4L6 9l5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>
    <div class="progress-wrap">
      <div class="progress-track">
        <div class="progress-fill" style:width="{progress}%"></div>
      </div>
      <span class="progress-text">{index + 1} <span class="of">of</span> {QUIZ_QUESTIONS.length}</span>
    </div>
    <div style="width:36px"></div>
  </header>

  <!-- Question -->
  {#key index}
  <div class="question-wrap" class:entering>
    <div class="question-inner">
      <span class="q-emoji" role="img" aria-hidden="true">{question.emoji}</span>
      <h2 class="q-text">{question.question}</h2>

      <div class="options" class:grid-3={question.options.length <= 3}>
        {#each question.options as opt, i (opt.value)}
          <button
            class="option"
            class:selected={selected === opt.value}
            style:animation-delay="{i * 45}ms"
            onclick={() => pick(opt.value)}
          >
            <span class="opt-icon" aria-hidden="true">{opt.icon}</span>
            <span class="opt-label">{opt.label}</span>
            <span class="opt-check" aria-hidden="true">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M2.5 7l3 3 6-6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </span>
          </button>
        {/each}
      </div>
    </div>
  </div>
  {/key}
</section>

<style>
  .quiz {
    position: relative; z-index: 2;
    min-height: 100svh;
    display: flex;
    flex-direction: column;
  }

  .header {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 18px 20px;
    position: sticky; top: 0; z-index: 10;
    background: rgba(0,0,0,0.6);
    backdrop-filter: blur(24px) saturate(180%);
    border-bottom: 1px solid rgba(255,255,255,0.06);
  }
  .back-btn {
    width: 36px; height: 36px;
    background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 50%;
    color: rgba(255,255,255,0.5);
    cursor: pointer;
    display: grid; place-items: center;
    transition: background 0.15s, color 0.15s, transform 0.15s;
    flex-shrink: 0;
  }
  .back-btn:hover { background: rgba(255,255,255,0.1); color: #f5f5f7; transform: scale(1.05); }
  .back-btn:active { transform: scale(0.95); }

  .progress-wrap {
    flex: 1;
    display: flex; align-items: center; gap: 10px;
  }
  .progress-track {
    flex: 1; height: 2px;
    background: rgba(255,255,255,0.08);
    border-radius: 2px; overflow: hidden;
  }
  .progress-fill {
    height: 100%;
    background: linear-gradient(90deg, #FF9F0A, #FFD60A);
    border-radius: 2px;
    transition: width 0.5s cubic-bezier(0.4,0,0.2,1);
    will-change: width;
  }
  .progress-text {
    font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
    font-size: 12px; font-weight: 600;
    color: rgba(255,255,255,0.3);
    white-space: nowrap;
    letter-spacing: 0.02em;
  }
  .of { font-weight: 300; }

  .question-wrap {
    flex: 1;
    display: flex; align-items: center; justify-content: center;
    padding: 40px 20px;
    opacity: 0;
    transform: translateY(16px);
  }
  .question-wrap.entering {
    animation: enterQ 0.4s cubic-bezier(0.22,1,0.36,1) forwards;
  }
  @keyframes enterQ {
    to { opacity: 1; transform: translateY(0); }
  }

  .question-inner {
    max-width: 580px; width: 100%;
    text-align: center;
  }

  .q-emoji {
    display: block;
    font-size: 3rem;
    margin-bottom: 20px;
    animation: floatEmoji 4s ease-in-out infinite;
  }
  @keyframes floatEmoji {
    0%,100% { transform: translateY(0) rotate(0deg); }
    50%      { transform: translateY(-8px) rotate(3deg); }
  }

  .q-text {
    font-family: 'Bricolage Grotesque', system-ui, sans-serif;
    font-size: clamp(1.6rem, 4.5vw, 2.5rem);
    font-weight: 700;
    letter-spacing: -0.025em;
    color: #f5f5f7;
    margin-bottom: 36px;
    line-height: 1.15;
  }

  .options {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  .options.grid-3 {
    grid-template-columns: repeat(3, 1fr);
  }
  @media (max-width: 460px) {
    .options, .options.grid-3 { grid-template-columns: 1fr 1fr; }
  }

  .option {
    background: rgba(255,255,255,0.03);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 16px;
    padding: 20px 14px 18px;
    cursor: pointer;
    display: flex; flex-direction: column; align-items: center; gap: 8px;
    color: rgba(255,255,255,0.65);
    font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
    transition: background 0.18s, border-color 0.18s, transform 0.18s cubic-bezier(0.34,1.56,0.64,1), color 0.18s;
    animation: optIn 0.4s cubic-bezier(0.22,1,0.36,1) both;
    will-change: transform;
    position: relative;
    overflow: hidden;
  }
  @keyframes optIn {
    from { opacity: 0; transform: scale(0.94) translateY(8px); }
    to   { opacity: 1; transform: scale(1) translateY(0); }
  }
  .option::before {
    content: '';
    position: absolute; inset: 0;
    background: radial-gradient(circle at 50% 0%, rgba(255,159,10,0.12), transparent 70%);
    opacity: 0;
    transition: opacity 0.2s;
  }
  .option:hover { background: rgba(255,255,255,0.06); border-color: rgba(255,255,255,0.16); transform: scale(1.02) translateY(-2px); color: #f5f5f7; }
  .option:hover::before { opacity: 1; }
  .option:active { transform: scale(0.97); }
  .option.selected {
    background: rgba(255,159,10,0.12);
    border-color: rgba(255,159,10,0.5);
    color: #FF9F0A;
    transform: scale(1.02);
  }
  .option.selected::before { opacity: 1; }

  .opt-icon { font-size: 1.6rem; line-height: 1; }
  .opt-label { font-size: 0.82rem; font-weight: 500; line-height: 1.35; }
  .opt-check {
    position: absolute; top: 10px; right: 10px;
    width: 20px; height: 20px;
    background: rgba(255,159,10,0.15);
    border-radius: 50%;
    display: grid; place-items: center;
    color: #FF9F0A;
    opacity: 0; transform: scale(0);
    transition: opacity 0.2s, transform 0.25s cubic-bezier(0.34,1.56,0.64,1);
  }
  .option.selected .opt-check { opacity: 1; transform: scale(1); }
</style>
