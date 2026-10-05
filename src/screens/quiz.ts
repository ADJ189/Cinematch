import { QUIZ_QUESTIONS } from '../data/quiz-questions';
import { prefersReducedMotion } from '../lib/a11y';
import { el, mount } from '../lib/dom';
import { store } from '../lib/store';
import type { QuizAnswers } from '../lib/types';

// Short labels that make the quiz read as a process, not a form.
const STAGE_LABELS = ['Starting point', 'Getting your vibe', 'Getting your vibe', 'Narrowing it down', 'Narrowing it down', 'Almost there', 'Last one'];

const EXIT_MS = 180;

export function renderQuiz(root: HTMLElement): () => void {
  let step = 0;
  let direction: 'forward' | 'back' = 'forward';
  let transitioning = false;
  let timer: number | null = null;
  let advanceTimer: number | null = null; // the short pause after an answer, before moving on
  const answers: QuizAnswers = { ...store.getState().quizAnswers };

  const screen = el('div', { class: 'screen quiz' });
  mount(root, screen);
  draw(true);

  function stageLabel(): string {
    return STAGE_LABELS[Math.min(step, STAGE_LABELS.length - 1)] ?? '';
  }

  function draw(initial = false) {
    const question = QUIZ_QUESTIONS[step];
    if (!question) return;

    const total = QUIZ_QUESTIONS.length;
    const rawOptions = question.filterOptions ? question.filterOptions(answers, question.options) : question.options;
    const selectedValue = (answers as Record<string, string | undefined>)[question.id];

    const options = rawOptions.map((opt, i) =>
      el(
        'button',
        {
          class: `quiz-option${opt.value === selectedValue ? ' selected' : ''}`,
          type: 'button',
          'aria-pressed': opt.value === selectedValue ? 'true' : 'false',
          style: `--i: ${i}`,
          onclick: (e: Event) => selectOption(question.id, opt.value, e.currentTarget as HTMLElement),
        },
        [el('span', { class: 'quiz-option-icon', 'aria-hidden': 'true' }, [opt.icon]), el('span', {}, [opt.label])]
      )
    );

    // One dot per question: filled = answered/current, so progress is
    // countable at a glance rather than an abstract percentage.
    const dots = el(
      'div',
      { class: 'quiz-dots', role: 'progressbar', 'aria-valuemin': 1, 'aria-valuemax': total, 'aria-valuenow': step + 1, 'aria-label': 'Quiz progress' },
      QUIZ_QUESTIONS.map((_, i) => el('span', { class: `quiz-dot${i < step ? ' done' : ''}${i === step ? ' current' : ''}` }))
    );

    const body = el('div', { class: `quiz-body ${initial ? 'enter-initial' : direction === 'forward' ? 'enter-forward' : 'enter-back'}` }, [
      el('h2', { class: 'quiz-question', tabindex: -1 }, [question.question]),
      el('p', { class: 'quiz-subtitle' }, [question.subtitle]),
      el('div', { class: 'quiz-options' }, options),
    ]);

    mount(
      screen,
      el('div', { class: 'quiz-frame' }, [
        el('div', { class: 'quiz-header' }, [
          dots,
          el('span', { class: 'quiz-step-label' }, [`Question ${step + 1} of ${total} · ${stageLabel()}`]),
        ]),
        body,
        step > 0 ? el('button', { class: 'btn btn-ghost quiz-back', type: 'button', onclick: goBack }, ['← Back']) : el('span'),
      ])
    );
    transitioning = false;
  }

  /** Plays the exit animation, then swaps in the next question. Reduced
   * motion skips straight to the swap — state changes stay clear without
   * any movement. */
  function go(next: () => void, dir: 'forward' | 'back') {
    if (transitioning) return;
    transitioning = true;
    direction = dir;
    next();
    const body = screen.querySelector<HTMLElement>('.quiz-body');
    if (!body || prefersReducedMotion()) {
      draw();
      return;
    }
    body.classList.add(dir === 'forward' ? 'exit-forward' : 'exit-back');
    timer = window.setTimeout(() => draw(), EXIT_MS);
  }

  function selectOption(id: keyof QuizAnswers, value: string, button: HTMLElement) {
    if (transitioning || advanceTimer !== null) return;
    // Clicking the already-chosen answer simply moves on; picking another
    // overwrites it. Either way Back keeps everything answered so far.
    (answers as Record<string, string>)[id] = value;
    screen.querySelectorAll('.quiz-option').forEach((o) => o.classList.remove('selected'));
    button.classList.add('selected', 'confirm');
    const last = step >= QUIZ_QUESTIONS.length - 1;
    advanceTimer = window.setTimeout(
      () => {
        advanceTimer = null;
        if (last) {
          store.setQuizAnswers(answers);
          store.setScreen('rating');
        } else {
          go(() => void (step += 1), 'forward');
        }
      },
      prefersReducedMotion() ? 0 : 160
    );
  }

  function goBack() {
    // Pressing Back during the post-answer pause cancels the pending
    // advance/submit instead of letting it fire afterwards.
    if (advanceTimer !== null) {
      window.clearTimeout(advanceTimer);
      advanceTimer = null;
    }
    if (step > 0) go(() => void (step -= 1), 'back');
    else screen.querySelectorAll('.quiz-option.confirm').forEach((o) => o.classList.remove('confirm'));
  }

  return () => {
    if (timer !== null) window.clearTimeout(timer);
    if (advanceTimer !== null) window.clearTimeout(advanceTimer);
  };
}
