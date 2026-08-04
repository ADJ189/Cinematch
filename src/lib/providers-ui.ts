// src/lib/providers-ui.ts
//
// Renders a TMDB/JustWatch watch-providers block (stream/rent/buy logos,
// a region picker, and a link to full availability). Shared between the
// search screen's hero and the quiz-results detail modal so streaming
// availability looks and behaves identically wherever it shows up,
// instead of two near-duplicate implementations drifting apart over
// time.
//
// mountProviders() owns the whole lifecycle — initial fetch, loading
// state, and refetching when the region selector changes — so call
// sites don't each need to re-implement "fetch, then swap in the row,
// then wire up a selector that fetches again."

import { el } from './dom';
import { getWatchProviders, providerLogoUrl, type WatchProviders } from './tmdb';
import { getRegionOverride, REGIONS, setRegion } from './region';

/** Mounts the whole streaming-availability block (loading state, then
 * provider logos + region selector) into `host`, fetching for the
 * current region and refetching whenever the user picks a different
 * one. `host` should be an otherwise-empty container the caller has
 * already placed in the DOM. Dispatch a 'providers-unmount' event on
 * `host` (e.g. when a modal closes) to stop a fetch that's still in
 * flight from writing into a detached element. */
export function mountProviders(host: HTMLElement, id: number, tmdbType: 'movie' | 'tv'): void {
  let cancelled = false;
  host.addEventListener('providers-unmount', () => {
    cancelled = true;
  });

  load();

  function load() {
    host.replaceChildren(buildProvidersLoading());
    void getWatchProviders(id, tmdbType)
      .then((providers) => {
        if (cancelled) return;
        host.replaceChildren(buildProvidersSection(providers));
      })
      .catch(() => {
        if (cancelled) return;
        host.replaceChildren(buildProvidersSection(null));
      });
  }

  function buildProvidersSection(providers: WatchProviders | null): HTMLElement {
    return el('div', { class: 'providers-section' }, [buildRegionSelect(load), buildProvidersRow(providers)]);
  }
}

/** A `<select>` of REGIONS, defaulting to "Auto-detect" unless the user
 * has previously picked a region — picking one persists it (region.ts)
 * and re-runs `onChange`, which refetches providers for the new region.
 * Lets someone check availability somewhere other than wherever their
 * browser locale happens to say they are — traveling, a family account
 * in another country, or just a browser locale that doesn't match. */
function buildRegionSelect(onChange: () => void): HTMLElement {
  const current = getRegionOverride();
  const select = el(
    'select',
    { class: 'region-select', 'aria-label': 'Streaming availability region' },
    [
      el('option', { value: '', selected: current === null }, ['Auto-detect region']),
      ...REGIONS.map((r) => el('option', { value: r.code, selected: current === r.code }, [r.name])),
    ]
  ) as HTMLSelectElement;
  select.addEventListener('change', () => {
    setRegion(select.value || null);
    onChange();
  });
  return el('div', { class: 'region-select-wrap' }, [select]);
}

export function buildProvidersRow(providers: WatchProviders | null): HTMLElement {
  if (!providers || (providers.stream.length === 0 && providers.rent.length === 0 && providers.buy.length === 0)) {
    return el('p', { class: 'providers-empty' }, [
      'No streaming availability found for this region — availability data comes from JustWatch via TMDB and isn\u2019t always complete.',
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

/** A lightweight loading placeholder shown while getWatchProviders()
 * resolves — providers is a separate TMDB call from the item's own
 * data, so it shouldn't block the rest of the detail view from
 * rendering immediately. */
export function buildProvidersLoading(): HTMLElement {
  return el('p', { class: 'providers-empty' }, ['Checking streaming availability…']);
}
