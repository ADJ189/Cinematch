// src/lib/rating-pool.ts
//
// The rating step used to always show the same fixed 15 titles regardless
// of what the quiz's mood question answered — so picking "horror" and then
// rating a list dominated by Pulp Fiction and La La Land gave the engine
// almost no horror-specific signal to calibrate against. This builds a
// pool weighted toward the chosen genre instead: ~75% titles that actually
// match the mood, ~25% broadly-known titles to keep general taste signal
// (comedy vs. drama vs. dark vs. feelgood) in the mix too.

import { RATING_SEEDS, SEED_SIGNALS as STATIC_SEED_SIGNALS } from '../data/rating-seeds';
import { keyOf } from './media-key';
import { discoverCandidates, isTmdbConfigured } from './tmdb';
import type { CatalogItem, Genre, RatingSeed } from './types';

const TOTAL = 15;
const GENRE_SHARE = 0.75;
const MIN_VOTE_COUNT = 500; // familiar, well-known titles calibrate taste better than long-tail picks

export interface RatingPool {
  seeds: RatingSeed[];
  signals: Record<string, string[]>;
}

export async function buildRatingPool(mood: Genre | undefined): Promise<RatingPool> {
  if (!mood || !isTmdbConfigured) {
    return { seeds: RATING_SEEDS, signals: STATIC_SEED_SIGNALS };
  }

  const genreCount = Math.round(TOTAL * GENRE_SHARE);
  const generalCount = TOTAL - genreCount;

  try {
    const candidates = await discoverCandidates({ mood });
    const topGenre = pickDiverse(
      candidates.filter((c) => c.voteCount >= MIN_VOTE_COUNT),
      genreCount
    );

    if (topGenre.length < genreCount / 2) {
      // Not enough well-known matches for this genre — better to fall back
      // than show a half-empty, mostly-irrelevant calibration list.
      return { seeds: RATING_SEEDS, signals: STATIC_SEED_SIGNALS };
    }

    const genreKeys = new Set(topGenre.map(keyOf));
    const generalPicks = RATING_SEEDS.filter((s) => !genreKeys.has(keyOf(s))).slice(0, generalCount);

    const seeds: RatingSeed[] = shuffle([
      ...topGenre.map(toRatingSeed),
      ...generalPicks,
    ]);

    const signals: Record<string, string[]> = { ...STATIC_SEED_SIGNALS };
    for (const c of topGenre) signals[keyOf(c)] = [...c.genres, ...c.vibe];

    return { seeds, signals };
  } catch {
    return { seeds: RATING_SEEDS, signals: STATIC_SEED_SIGNALS };
  }
}

function toRatingSeed(c: CatalogItem): RatingSeed {
  return { id: c.id, title: c.title, year: c.year, type: c.type, tmdbType: c.tmdbType, posterPath: c.posterPath };
}

/** Highest-vote-count first, but caps how many of the same exact vibe
 * combination can appear back to back so the list isn't ten near-identical
 * dark thrillers in a row. */
function pickDiverse(candidates: CatalogItem[], count: number): CatalogItem[] {
  const sorted = [...candidates].sort((a, b) => b.voteCount - a.voteCount);
  const out: CatalogItem[] = [];
  const seenIds = new Set<string>();
  const vibeCounts = new Map<string, number>();

  for (const c of sorted) {
    if (out.length >= count) break;
    if (seenIds.has(keyOf(c))) continue;
    const vibeKey = c.vibe.slice().sort().join(',');
    const n = vibeCounts.get(vibeKey) ?? 0;
    if (n >= Math.ceil(count / 3)) continue;
    out.push(c);
    seenIds.add(keyOf(c));
    vibeCounts.set(vibeKey, n + 1);
  }

  // Backfill with whatever's left if the diversity cap left us short.
  if (out.length < count) {
    for (const c of sorted) {
      if (out.length >= count) break;
      if (!seenIds.has(keyOf(c))) {
        out.push(c);
        seenIds.add(keyOf(c));
      }
    }
  }

  return out;
}

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
