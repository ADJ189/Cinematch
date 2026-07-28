import './styles/global.css';
import './styles/header.css';
import './styles/landing.css';
import './styles/quiz.css';
import './styles/rating.css';
import './styles/results.css';
import './styles/modal.css';

import { renderLanding } from './screens/landing';
import { renderQuiz } from './screens/quiz';
import { renderRating } from './screens/rating';
import { renderResults } from './screens/results';
import { store } from './lib/store';
import { initTheme } from './lib/theme';
import { renderHeader } from './lib/header';
import type { Screen } from './lib/types';

initTheme();

const appRoot = document.getElementById('app');
if (!appRoot) throw new Error('#app root element missing from index.html');

appRoot.appendChild(renderHeader());
const app = createScreenHost(appRoot);

function createScreenHost(root: HTMLElement): HTMLElement {
  const host = document.createElement('div');
  host.className = 'screen-host';
  root.appendChild(host);
  return host;
}

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
