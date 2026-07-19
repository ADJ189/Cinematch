import { QUIZ_QUESTIONS } from '../data/quiz-questions';
import { el, mount } from '../lib/dom';
import { store } from '../lib/store';
import type { QuizAnswers } from '../lib/types';

export function renderQuiz(root: HTMLElement): () => void {
  let step = 0;
  const answers: QuizAnswers = { ...store.getState().quizAnswers };

  function draw() {
    const question = QUIZ_QUESTIONS[step];
    if (!question) return;

    const progressPct = Math.round(((step + 1) / QUIZ_QUESTIONS.length) * 100);

    const options = question.options.map((opt) =>
      el(
        'button',
        {
          class: 'quiz-option',
          onclick: () => selectOption(question.id, opt.value),
        },
        [el('span', { class: 'quiz-option-icon' }, [opt.icon]), el('span', {}, [opt.label])]
      )
    );

    const screen = el('div', { class: 'screen quiz' }, [
      el('div', { class: 'quiz-header' }, [
        el('div', { class: 'progress-track' }, [
          el('div', { class: 'progress-fill', style: `width: ${progressPct}%` }),
        ]),
        el('span', { class: 'quiz-step-label' }, [`${step + 1} of ${QUIZ_QUESTIONS.length}`]),
      ]),
      el('div', { class: 'quiz-body' }, [
        el('h2', { class: 'quiz-question' }, [question.question]),
        el('p', { class: 'quiz-subtitle' }, [question.subtitle]),
        el('div', { class: 'quiz-options' }, options),
      ]),
      step > 0
        ? el('button', { class: 'btn btn-ghost quiz-back', onclick: goBack }, ['← Back'])
        : el('span'),
    ]);

    mount(root, screen);
  }

  function selectOption(id: keyof QuizAnswers, value: string) {
    (answers as Record<string, string>)[id] = value;
    if (step < QUIZ_QUESTIONS.length - 1) {
      step += 1;
      draw();
    } else {
      store.setQuizAnswers(answers);
      store.setScreen('rating');
    }
  }

  function goBack() {
    if (step > 0) {
      step -= 1;
      draw();
    }
  }

  draw();
  return () => {};
}
