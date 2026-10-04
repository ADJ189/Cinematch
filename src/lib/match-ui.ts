// src/lib/match-ui.ts — the "how well does this fit, and why" pieces,
// shared by the result cards, the featured pick and the detail modal.

import { el } from './dom';
import type { FitLevel, ScoredItem } from './types';

const FIT_LABEL: Record<FitLevel, string> = {
  strong: 'Strong fit',
  good: 'Good fit',
  stretch: 'A stretch',
};

/** Percentage + bar + plain-language confidence ("Strong fit"), so a score
 * never reads as false precision. The bar animates from 0 via a CSS var. */
export function buildMatchMeter(item: ScoredItem, size: 'sm' | 'lg' = 'sm'): HTMLElement {
  return el('div', { class: `match-meter match-meter-${size}`, 'data-fit': item.fit }, [
    el('div', { class: 'match-meter-head' }, [
      el('span', { class: 'match-meter-pct' }, [`${item.matchPct}% match`]),
      el('span', { class: 'match-meter-fit' }, [FIT_LABEL[item.fit]]),
    ]),
    el('div', { class: 'match-meter-track', role: 'presentation' }, [
      el('div', { class: 'match-meter-fill', style: `--fill: ${item.matchPct}%` }),
    ]),
  ]);
}

/** "Why it matched" chips — only tags the taste profile actually favors. */
export function buildReasonChips(item: ScoredItem): HTMLElement | null {
  if (item.matchedTags.length === 0) return null;
  return el(
    'ul',
    { class: 'chip-row', 'aria-label': 'Why it matched' },
    item.matchedTags.map((t) => el('li', { class: 'chip' }, [t]))
  );
}
