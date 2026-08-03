// src/lib/credits-ui.ts
//
// Renders a title's cast strip + director/creator line, with each person
// clickable through to their own page (bio + best-known work) — the
// Jellyfin/Plex "click an actor from the movie page" pattern. Shared
// between the search screen's title hero and the results detail modal.

import { el } from './dom';
import { personImageUrl } from './tmdb';
import type { Credits } from './types';

/** `onPersonClick` is left to the caller: the search screen navigates
 * in-place (it already owns a detail host to swap content into), while
 * the results screen's modal has to close itself and hand off to the
 * search screen instead — same UI, different navigation context. */
export function buildCreditsBlock(credits: Credits, onPersonClick: (personId: number) => void): HTMLElement | null {
  if (credits.cast.length === 0 && credits.directors.length === 0) return null;

  const directorLine =
    credits.directors.length > 0
      ? el(
          'p',
          { class: 'credits-directors' },
          [
            `${credits.directors.length > 1 ? 'Creators' : credits.directors[0]!.job === 'Creator' ? 'Creator' : 'Director'}: `,
            ...credits.directors.flatMap((d, i) => {
              const link = personLink(d.id, d.name, onPersonClick);
              return i === 0 ? [link] : [', ', link];
            }),
          ]
        )
      : null;

  const castRow =
    credits.cast.length > 0
      ? el(
          'div',
          { class: 'credits-cast-row' },
          credits.cast.slice(0, 10).map((c) => {
            const photo = personImageUrl(c.profilePath);
            const btn = el(
              'button',
              { class: 'credits-cast-chip', onclick: () => onPersonClick(c.id) },
              [
                photo
                  ? el('img', { src: photo, alt: c.name, class: 'credits-cast-photo', loading: 'lazy' })
                  : el('span', { class: 'credits-cast-photo credits-cast-fallback' }, [c.name.slice(0, 1)]),
                el('span', { class: 'credits-cast-name' }, [c.name]),
                el('span', { class: 'credits-cast-character' }, [c.character || '\u00a0']),
              ]
            );
            return btn;
          })
        )
      : null;

  return el('div', { class: 'credits-block' }, [...(directorLine ? [directorLine] : []), ...(castRow ? [castRow] : [])]);
}

function personLink(id: number, name: string, onClick: (id: number) => void): HTMLElement {
  return el('button', { class: 'credits-person-link', onclick: () => onClick(id) }, [name]);
}
