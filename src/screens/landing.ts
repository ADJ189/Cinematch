import { applyVibe, markVibeHandled, vibeAlreadyHandled, VIBES } from '../lib/appearance';
import { el, mount } from '../lib/dom';
import { openAppearancePanel } from '../lib/settings-panel';
import { getProfile, getStats } from '../lib/profile';
import { store } from '../lib/store';
import { isTmdbConfigured } from '../lib/tmdb';

/** The hero's "product as the artwork" panel: a sample recommendation card
 * drawn with CSS only (no studio posters, no network), labelled as a sample
 * so it never reads as a real recommendation. */
function buildSampleCard(): HTMLElement {
  return el('div', { class: 'hero-visual', 'aria-hidden': 'true' }, [
    el('div', { class: 'hero-poster hero-poster-back' }),
    el('div', { class: 'hero-poster hero-poster-mid' }),
    el('div', { class: 'hero-sample' }, [
      el('div', { class: 'hero-sample-art' }, [el('span', { class: 'hero-sample-badge' }, ['94% match'])]),
      el('div', { class: 'hero-sample-body' }, [
        el('p', { class: 'hero-sample-label' }, ['Sample match']),
        el('div', { class: 'hero-sample-meter' }, [el('i')]),
        el('ul', { class: 'chip-row' }, [el('li', { class: 'chip' }, ['thriller']), el('li', { class: 'chip' }, ['dark']), el('li', { class: 'chip' }, ['2016+'])]),
        el('p', { class: 'hero-sample-reason' }, ['Matches your thriller pick \u00b7 Has that dark vibe']),
      ]),
    ]),
  ]);
}

export function renderLanding(root: HTMLElement): () => void {
  let destroyed = false;
  let ambient: { destroy(): void } | null = null;

  const canvas = el('canvas', { class: 'landing-canvas', 'aria-hidden': 'true' });

  const warning = isTmdbConfigured
    ? null
    : el('p', { class: 'config-warning', role: 'status' }, [
        'Live recommendations are switched off: this build has no TMDB API key. ',
        'Add one (see the README) to get results.',
      ]);

  const stats = getStats();
  const returning = stats.ratedCount > 0;
  const welcomeBack = returning
    ? (() => {
        const p = getProfile();
        return el('p', { class: 'welcome-back reveal', style: '--reveal: 3' }, [
          el('span', { class: 'avatar-circle', style: `background:${p.avatarColor}` }, [p.avatarEmoji ?? p.displayName.charAt(0).toUpperCase()]),
          el('span', {}, [
            el('strong', {}, [`Welcome back, ${p.displayName}`]),
            ` \u00b7 ${stats.ratedCount} title${stats.ratedCount === 1 ? '' : 's'} rated here so far. New picks build on all of it.`,
          ]),
        ]);
      })()
    : null;

  // One-time, skippable "Choose your vibe". It only sets ordinary
  // appearance options and never sits in front of the primary action.
  let vibeCard: HTMLElement | null = null;
  if (!vibeAlreadyHandled()) {
    const dismiss = (permanent: boolean) => {
      if (permanent) markVibeHandled('skipped');
      vibeCard?.remove();
    };
    vibeCard = el('section', { class: 'vibe-card reveal', style: '--reveal: 5', 'aria-label': 'Choose your look' }, [
      el('div', { class: 'vibe-card-head' }, [
        el('strong', {}, ['Choose your vibe']),
        el('span', {}, ['Optional \u2014 change it any time from Appearance.']),
      ]),
      el(
        'div',
        { class: 'vibe-row' },
        VIBES.map((v) =>
          el(
            'button',
            {
              class: 'chip chip-btn',
              type: 'button',
              title: v.blurb,
              onclick: () => {
                applyVibe(v.id);
                vibeCard?.remove();
              },
            },
            [v.label]
          )
        )
      ),
      el('div', { class: 'vibe-card-actions' }, [
        el('button', { class: 'btn-text', type: 'button', onclick: () => dismiss(true) }, ['Skip']),
        el('button', { class: 'btn-text', type: 'button', onclick: () => dismiss(false) }, ['Not now']),
        el('button', { class: 'btn-text', type: 'button', onclick: () => openAppearancePanel('themes') }, ['More options\u2026']),
      ]),
    ]);
  }

  const screen = el('div', { class: 'screen landing' }, [
    canvas,
    el('div', { class: 'landing-grid' }, [
      el('div', { class: 'landing-content' }, [
        el('span', { class: 'eyebrow reveal', style: '--reveal: 0' }, ['No account \u00b7 your profile stays on this device']),
        el('h1', { class: 'landing-title reveal', style: '--reveal: 1', tabindex: '-1' }, ['Find something you\u2019ll actually like']),
        el('p', { class: 'landing-sub reveal', style: '--reveal: 2' }, [
          'Seven quick questions, a few titles you already know, and a live pull from thousands of movies and shows \u2014 matched to you, not to what everyone else is watching.',
        ]),
        ...(welcomeBack ? [welcomeBack] : []),
        el('div', { class: 'landing-actions reveal', style: '--reveal: 4' }, [
          el('button', { class: 'btn btn-primary btn-lg', type: 'button', onclick: () => store.setScreen('quiz') }, [
            returning ? 'Get fresh picks' : 'Find my next watch',
            ' \u2192',
          ]),
          el('button', { class: 'btn btn-quiet', type: 'button', onclick: () => store.setScreen('search') }, ['Search a title you love']),
        ]),
        el('p', { class: 'landing-trust reveal', style: '--reveal: 4' }, ['7 questions \u00b7 about a minute \u00b7 no account required']),
        ...(vibeCard ? [vibeCard] : []),
        ...(warning ? [warning] : []),
      ]),
      buildSampleCard(),
    ]),
  ]);

  mount(root, screen);

  // The particle field is a progressive enhancement: the hero is fully
  // readable without it, and the module is only fetched on this screen.
  // `destroyed` closes the race where the person leaves before the import
  // resolves — without it the loop would start after cleanup and run forever.
  requestAnimationFrame(() => {
    if (destroyed) return;
    void import('../lib/ambient')
      .then(({ AmbientField }) => {
        if (destroyed) return;
        ambient = new AmbientField(canvas);
      })
      .catch(() => {
        /* decorative only */
      });
  });

  return () => {
    destroyed = true;
    ambient?.destroy();
    ambient = null;
  };
}
