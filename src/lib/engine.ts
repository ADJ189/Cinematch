// src/lib/engine.ts
//
// Rewritten scoring model. The old engine let a flat "quality bonus" of up
// to ±12.5 points drown out quiz signal worth only 20-30 points, so a
// handful of high-TMDB-rated titles won almost every time regardless of
// what the user answered. Fixed here by:
//   1. Capping the quality bonus to ±3 (a tiebreaker, not a driver).
//   2. Scoring against a live, hundreds-wide TMDB candidate pool instead of
//      a fixed 30-item array, so there's actually room to differentiate.
//   3. Weighting rating-derived taste signal higher than one-off quiz picks,
//      since it's a stronger preference signal.

import { keyOf, mediaKey } from './media-key';
import type {
  CatalogItem,
  Company,
  Genre,
  GenreAffinityMap,
  QuizAnswers,
  RatingSeed,
  RatingValue,
  ScoredItem,
  Vibe,
} from './types';

const VIBES = new Set<string>(['dark', 'light', 'intellectual', 'feelgood', 'epic']);

const COMPANY_TILT: Record<Company, { genre: Record<string, number>; vibe: Record<string, number> }> = {
  solo: { genre: {}, vibe: {} },
  date: { genre: { drama: 0.35, comedy: 0.35, horror: -0.4 }, vibe: { feelgood: 0.35, light: 0.2 } },
  friends: { genre: { comedy: 0.4, horror: 0.25, adventure: 0.3 }, vibe: { light: 0.2 } },
  family: {
    genre: { cartoon: 0.6, adventure: 0.5, comedy: 0.3, horror: -1.4, thriller: -0.9 },
    vibe: { feelgood: 0.5, light: 0.4, dark: -1.2 },
  },
};

export class RecommendationEngine {
  private genre: GenreAffinityMap = {};
  private vibe: GenreAffinityMap = {};
  private answers: QuizAnswers = {};
  private ratings: Record<string, number> = {};
  private ratedSeeds: RatingSeed[] = [];

  processQuiz(answers: QuizAnswers): void {
    this.answers = answers;
    if (answers.mood) this.genre[answers.mood] = (this.genre[answers.mood] ?? 0) + 1.0;
    if (answers.vibe) this.vibe[answers.vibe] = (this.vibe[answers.vibe] ?? 0) + 1.0;
    // "Who's watching" shifts the weights rather than hard-filtering: a
    // family night leans toward adventure/animation/warm titles and away
    // from horror and dark thrillers; friends lean toward comedy, horror
    // and adventure; a date leans toward drama, comedy and warm picks.
    // Solo has no adjustment — it is the unmodified taste profile.
    const tilt = COMPANY_TILT[answers.company ?? 'solo'];
    for (const [tag, w] of Object.entries(tilt.genre)) this.genre[tag] = (this.genre[tag] ?? 0) + w;
    for (const [tag, w] of Object.entries(tilt.vibe)) this.vibe[tag] = (this.vibe[tag] ?? 0) + w;
    if (answers.contentType && answers.contentType !== 'live_action') {
      // An explicit style pick (anime/cartoon/sitcom) is more specific than
      // the mood tap, so it's weighted a little higher.
      const g = answers.contentType;
      this.genre[g] = (this.genre[g] ?? 0) + 1.2;
    }
  }

  /**
   * `signalsBySeedId` maps each rated seed's id to the genre/vibe tags it
   * represents, so the caller decides the taste vocabulary (kept out of the
   * engine to avoid re-introducing a hardcoded catalog dependency here).
   */
  processRatings(
    ratings: Record<string, RatingValue>,
    seeds: RatingSeed[],
    signalsBySeedKey: Record<string, string[]>
  ): void {
    this.ratings = { ...this.ratings, ...ratings };
    this.ratedSeeds = seeds;

    for (const [key, rating] of Object.entries(ratings)) {
      const signals = signalsBySeedKey[key] ?? [];
      // -1 (hated) to +1 (loved), weighted higher than a single quiz tap
      // since a rating reflects an actual watched title, not a mood guess.
      const weight = ((rating - 3) / 2) * 0.7;
      for (const signal of signals) {
        if (VIBES.has(signal)) this.vibe[signal] = (this.vibe[signal] ?? 0) + weight;
        else this.genre[signal] = (this.genre[signal] ?? 0) + weight;
      }
    }
  }

  /**
   * Lets the user keep rating titles directly on the results screen and get
   * a re-curated list without starting over. Unlike processRatings (which
   * needs a signal map for the fixed calibration seeds), this reads
   * genre/vibe straight off the live CatalogItem being rated — every live
   * TMDB result already carries that data, so no lookup table is needed.
   * Weighted slightly higher than a calibration-seed rating: rating an
   * actual recommendation the engine just made is the strongest signal
   * the app gets.
   */
  processResultRating(item: CatalogItem, rating: number, weightScale = 1): void {
    this.ratings = { ...this.ratings, [keyOf(item)]: rating };
    const weight = ((rating - 3) / 2) * 0.85 * weightScale;
    for (const g of item.genres) this.genre[g] = (this.genre[g] ?? 0) + weight;
    for (const v of item.vibe) this.vibe[v] = (this.vibe[v] ?? 0) + weight;
  }

  private scoreItem(item: CatalogItem): number {
    let s = 0;
    // Affinities are summed from many ratings, so they're saturated: a
    // lot of agreeing ratings strengthens a taste only up to a ceiling
    // (AFFINITY_CAP), instead of growing without bound and pushing every
    // matching title to the flat top of the match curve.
    for (const g of item.genres) s += saturate(this.genre[g] ?? 0) * 30;
    for (const v of item.vibe) s += saturate(this.vibe[v] ?? 0) * 20;

    const { language } = this.answers;
    if (language === 'english') s += item.language === 'en' ? 8 : -14;
    else if (language === 'subtitles') s += item.language !== 'en' ? 4 : 0;

    // Quality is a tiebreaker only — capped so it can never override a
    // genuine genre/vibe mismatch the way the old ±12.5 bonus did.
    const qualityBonus = Math.max(-3, Math.min(3, (item.voteAverage - 6.5) * 1.2));
    s += qualityBonus;

    // Blend in external ratings if the OMDb connector resolved them.
    if (item.externalRatings) {
      const { rottenTomatoes, metacritic } = item.externalRatings;
      if (rottenTomatoes !== undefined) s += ((rottenTomatoes - 60) / 40) * 2;
      if (metacritic !== undefined) s += ((metacritic - 60) / 40) * 2;
    }

    // Mild popularity floor so obscure long-tail noise doesn't crowd out
    // recognizable picks, without letting popularity dominate over taste.
    s += Math.min(3, Math.log10(Math.max(1, item.popularity)) * 1.2);

    return s;
  }

  private getReasonsFor(item: CatalogItem, signalsBySeedKey: Record<string, string[]>): string[] {
    const out: string[] = [];
    if (this.answers.mood && item.genres.includes(this.answers.mood)) {
      out.push(`Matches your ${this.answers.mood} pick`);
    }
    if (this.answers.vibe && item.vibe.includes(this.answers.vibe)) {
      out.push(`Has that ${this.answers.vibe} vibe`);
    }
    if (
      this.answers.contentType &&
      this.answers.contentType !== 'live_action' &&
      item.genres.includes(this.answers.contentType as Genre)
    ) {
      const label = this.answers.contentType === 'sitcom' ? 'sitcom' : this.answers.contentType;
      out.push(`It's the ${label} pick you asked for`);
    }
    if (item.voteAverage >= 8) {
      out.push(`Highly rated (${item.voteAverage.toFixed(1)}/10)`);
    }

    const loved = Object.entries(this.ratings)
      .filter(([, r]) => r >= 4)
      .map(([key]) => key);
    for (const hKey of loved) {
      const sigs = signalsBySeedKey[hKey] ?? [];
      const overlaps = sigs.some(
        (g) => item.genres.includes(g as Genre) || item.vibe.includes(g as Vibe)
      );
      if (overlaps) {
        const title = this.ratedSeeds.find((t) => mediaKey(t.tmdbType, t.id) === hKey)?.title;
        if (title) {
          out.push(`Similar to ${title}, which you loved`);
          break;
        }
      }
    }

    if (out.length === 0) out.push('Popular pick that fits your filters');
    return out.slice(0, 3);
  }

  getResults(candidates: CatalogItem[], signalsBySeedKey: Record<string, string[]>): ScoredItem[] {
    const { era } = this.answers;

    // De-dupe by id (TMDB can return the same title across paginated pages),
    // and hard-enforce the era pick. This used to be a soft scoring nudge
    // only — the candidate pool from tmdb.ts is already era-filtered
    // server-side, but that filter isn't airtight (a title can carry a
    // re-release/rebroadcast date, or TMDB's date field can simply be off),
    // so a stray out-of-era item could slip into the pool and, if its
    // genre/vibe match was strong, still outscore in-era titles. Filtering
    // here guarantees the era you pick is the era you get, regardless of
    // how the item entered the pool.
    const seen = new Set<string>();
    const pool = candidates.filter((c) => {
      const k = keyOf(c);
      if (seen.has(k)) return false;
      seen.add(k);
      if (era && era !== 'any' && c.era !== era) return false;
      return true;
    });

    const scored = pool.map((item) => ({ item, raw: this.scoreItem(item) }));
    scored.sort((a, b) => b.raw - a.raw);

    const maxScore = scored[0]?.raw ?? 0;
    const minScore = scored[scored.length - 1]?.raw ?? 0;
    const range = Math.max(1, maxScore - minScore);

    return scored.map(({ item, raw }) => {
      const matchPct = calibratedMatch(raw);
      return {
        ...item,
        matchPct,
        rankPct: Math.round(((raw - minScore) / range) * 100),
        score: raw,
        fit: matchPct >= 85 ? 'strong' : matchPct >= 68 ? 'good' : 'stretch',
        reasons: this.getReasonsFor(item, signalsBySeedKey),
        matchedTags: this.matchedTagsFor(item),
      };
    });
  }

  private matchedTagsFor(item: CatalogItem): string[] {
    const tags: string[] = [];
    for (const g of item.genres) if ((this.genre[g] ?? 0) > 0.2) tags.push(g);
    for (const v of item.vibe) if ((this.vibe[v] ?? 0) > 0.2) tags.push(v);
    return tags.slice(0, 4);
  }
}

/**
 * Absolute match calibration. The old formula min/max-scaled every batch,
 * so the worst title in any pool read ~1% and the best ~99% no matter how
 * weak the pool was — "92%" only meant "near the top of this batch".
 * Raw scores have a stable scale (genre affinity x30, vibe x20, small
 * bounded bonuses), so a fixed squashing curve gives percentages that mean
 * the same thing across searches: ~35% with no taste signal, ~70% for a
 * solid single-signal fit, 90%+ when mood, vibe and history all agree.
 */
const AFFINITY_CAP = 1.5;
/** Smoothly bounds an affinity to ±AFFINITY_CAP; near-linear for the small
 * values a quiz answer produces, so ordinary behavior is unchanged. */
function saturate(x: number): number {
  return AFFINITY_CAP * Math.tanh(x / AFFINITY_CAP);
}

// Fitted to the bounded raw range (affinity cap x weights): a one-signal
// fit lands ~mid-70s, several agreeing signals reach the 90s, and heavy
// libraries can't push every title to the ceiling.
const MATCH_CENTER = 18;
const MATCH_SCALE = 30;
export function calibratedMatch(raw: number): number {
  const pct = 50 + 49 * Math.tanh((raw - MATCH_CENTER) / MATCH_SCALE);
  return Math.max(1, Math.min(99, Math.round(pct)));
}
