import './styles/global.css';
import './styles/landing.css';
import './styles/quiz.css';
import './styles/rating.css';
import './styles/results.css';

import { renderLanding } from './screens/landing';
import { renderQuiz } from './screens/quiz';
import { renderRating } from './screens/rating';
import { renderResults } from './screens/results';
import { store } from './lib/store';
import type { Screen } from './lib/types';

const app = document.getElementById('app');
if (!app) throw new Error('#app root element missing from index.html');

const renderers: Record<Screen, (root: HTMLElement) => () => void> = {
  landing: renderLanding,
  quiz: renderQuiz,
  rating: renderRating,
  results: renderResults,
};

let currentCleanup: (() => void) | null = null;
let currentScreen: Screen | null = null;

store.subscribe((state) => {
  if (state.screen === currentScreen) return;
  currentCleanup?.();
  currentScreen = state.screen;
  currentCleanup = renderers[state.screen](app);
});
