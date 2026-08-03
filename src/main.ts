import './styles/global.css';
import './styles/header.css';
import './styles/landing.css';
import './styles/quiz.css';
import './styles/rating.css';
import './styles/results.css';
import './styles/modal.css';
import './styles/search.css';
import './styles/credits.css';

import { renderLanding } from './screens/landing';
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

type Renderer = (root: HTMLElement) => () => void;

// Landing is the only screen every visit actually needs — it's rendered
// eagerly. Everything reachable *from* landing (quiz, rating, results,
// search) is a separate chunk, fetched only once the person actually
// navigates there. This matters more now than it used to: the search
// screen alone pulls in TMDB similarity/watch-provider logic that a
// landing-only bounce (a real, common case — someone previews the app
// and leaves) would otherwise pay for and never use.
const eagerRenderers: Partial<Record<Screen, Renderer>> = { landing: renderLanding };
const lazyLoaders: Partial<Record<Screen, () => Promise<Renderer>>> = {
  quiz: () => import('./screens/quiz').then((m) => m.renderQuiz),
  rating: () => import('./screens/rating').then((m) => m.renderRating),
  results: () => import('./screens/results').then((m) => m.renderResults),
  search: () => import('./screens/search').then((m) => m.renderSearch),
};

let currentCleanup: (() => void) | null = null;
let currentScreen: Screen | null = null;
// Guards against a rapid double-navigation resolving out of order — e.g.
// tapping quiz then immediately back to landing before quiz's chunk has
// finished loading; without this the quiz screen could still render
// itself onto the host after landing already took over.
let navToken = 0;

store.subscribe((state) => {
  if (state.screen === currentScreen) return;
  const token = ++navToken;
  currentCleanup?.();
  currentCleanup = null;
  currentScreen = state.screen;

  const eager = eagerRenderers[state.screen];
  if (eager) {
    currentCleanup = eager(app);
    return;
  }

  const loader = lazyLoaders[state.screen];
  if (!loader) return;
  app.classList.add('screen-loading');
  void loader().then((renderer) => {
    if (token !== navToken) return;
    app.classList.remove('screen-loading');
    currentCleanup = renderer(app);
  });
});

dismissBootLoader();

function dismissBootLoader() {
  const loader = document.getElementById('boot-loader');
  if (!loader) return;
  // rAF so the first screen's own paint has actually happened before we
  // start fading the loader out — avoids a one-frame flash of bare page.
  requestAnimationFrame(() => {
    loader.classList.add('hidden');
    setTimeout(() => loader.remove(), 320);
  });
}
