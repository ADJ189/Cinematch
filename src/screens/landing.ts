import { el, mount } from '../lib/dom';
import { getProfile, getStats } from '../lib/profile';
import { store } from '../lib/store';
import { isTmdbConfigured } from '../lib/tmdb';

export function renderLanding(root: HTMLElement): () => void {
  let fluidCleanup: (() => void) | null = null;

  const canvas = el('canvas', {
    class: 'landing-canvas',
    'aria-hidden': 'true',
  });

  const warning = isTmdbConfigured
    ? null
    : el(
        'p',
        { class: 'config-warning', role: 'status' },
        [
          'Running in offline demo mode — add a TMDB API key to ',
          'get live, personalized results. See README.',
        ]
      );

  const stats = getStats();
  const welcomeBack =
    stats.ratedCount > 0
      ? (() => {
          const p = getProfile();
          return el('div', { class: 'welcome-back stagger-in' }, [
            el('span', { class: 'avatar-circle', style: `background:${p.avatarColor}` }, [
              p.avatarEmoji ?? p.displayName.charAt(0).toUpperCase(),
            ]),
            el('p', {}, [
              `Welcome back, ${p.displayName} — `,
              `${stats.ratedCount} title${stats.ratedCount === 1 ? '' : 's'} rated on this device so far. `,
              'New picks build on all of it, not just this session.',
            ]),
          ]);
        })()
      : null;

  const screen = el('div', { class: 'screen landing' }, [
    canvas,
    el('div', { class: 'landing-content' }, [
      el('span', { class: 'eyebrow' }, ['no account · no cineMatch tracking · your profile stays on this device']),
      el('h1', { class: 'landing-title reveal', style: '--reveal: 0' }, ['Find something you\u2019ll actually like']),
      el('p', { class: 'landing-sub reveal', style: '--reveal: 1' }, [
        'Seven quick questions, a few titles you already know, and a live pull from thousands of movies and shows — matched to you, not to what everyone else is watching.',
      ]),
      ...(welcomeBack ? [welcomeBack] : []),
      el('div', { class: 'landing-actions reveal', style: '--reveal: 2' }, [
        el(
          'button',
          {
            class: 'btn btn-primary',
            onclick: () => store.setScreen('quiz'),
          },
          [stats.ratedCount > 0 ? 'Get fresh picks' : 'Find my next watch', ' →']
        ),
        el(
          'button',
          { class: 'btn btn-ghost', onclick: () => store.setScreen('search') },
          ['Search a title you love']
        ),
      ]),
      el('p', { class: 'landing-trust reveal', style: '--reveal: 3' }, ['7 questions · about a minute · no account required']),
      ...(warning ? [warning] : []),
    ]),
  ]);

  mount(root, screen);

  // Lazy-load the fluid sim so the initial screen paints instantly; the
  // hero background is a progressive enhancement, not a blocker.
  requestAnimationFrame(async () => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const { FluidSim } = await import('../lib/fluid');

    // This sim runs on the CPU (Canvas2D, not WebGL/WebGPU), so its cost
    // scales directly with grid resolution. Full resolution is fine on a
    // desktop but a real jank/battery cost on phones — scale it down for
    // mobile or low-core devices instead of shipping one fixed cost to
    // every device.
    const cores = navigator.hardwareConcurrency || 4;
    const isMobile = /Android|iPhone|iPad|iPod|Mobi/i.test(navigator.userAgent);
    const lite = isMobile || cores <= 4;

    const sim = new FluidSim(canvas, lite ? { N: 40, iterations: 4 } : undefined);
    fluidCleanup = () => sim.destroy();
  });

  return () => {
    fluidCleanup?.();
  };
}
