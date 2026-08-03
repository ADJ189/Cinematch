// src/lib/providers-ui.ts
//
// Renders a TMDB/JustWatch watch-providers block (stream/rent/buy logos +
// a link to full availability). Shared between the search screen's hero
// and the quiz-results detail modal so streaming availability looks and
// behaves identically wherever it shows up, instead of two near-duplicate
// implementations drifting apart over time.

import { el } from './dom';
import { providerLogoUrl, type WatchProviders } from './tmdb';

export function buildProvidersRow(providers: WatchProviders | null): HTMLElement {
  if (!providers || (providers.stream.length === 0 && providers.rent.length === 0 && providers.buy.length === 0)) {
    return el('p', { class: 'providers-empty' }, [
      'No streaming availability found for your region — availability data comes from JustWatch via TMDB and isn\u2019t always complete.',
    ]);
  }
  const rows: HTMLElement[] = [];
  const addRow = (label: string, list: WatchProviders['stream']) => {
    if (list.length === 0) return;
    rows.push(
      el('div', { class: 'providers-row' }, [
        el('span', { class: 'providers-label' }, [label]),
        el(
          'div',
          { class: 'providers-logos' },
          list.slice(0, 6).map((p) => {
            const logo = providerLogoUrl(p.logoPath);
            return logo
              ? el('img', { src: logo, alt: p.name, title: p.name, class: 'provider-logo', loading: 'lazy' })
              : el('span', { class: 'provider-logo-fallback', title: p.name }, [p.name.slice(0, 1)]);
          })
        ),
      ])
    );
  };
  addRow('Stream', providers.stream);
  addRow('Rent', providers.rent);
  addRow('Buy', providers.buy);
  return el('div', { class: 'providers-block' }, [
    ...rows,
    providers.link
      ? el('a', { class: 'providers-link', href: providers.link, target: '_blank', rel: 'noopener' }, [
          `Full availability on JustWatch (${providers.region}) ↗`,
        ])
      : el('p', { class: 'providers-note' }, [`Region: ${providers.region}. Availability via JustWatch/TMDB, not guaranteed current.`]),
  ]);
}

/** A lightweight loading placeholder swapped for the real row once
 * getWatchProviders() resolves — providers is a separate TMDB call from
 * the item's own data, so it shouldn't block the rest of the detail view
 * from rendering immediately. */
export function buildProvidersLoading(): HTMLElement {
  return el('p', { class: 'providers-empty' }, ['Checking streaming availability…']);
}
