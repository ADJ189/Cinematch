// src/lib/profile.ts
//
// A local profile: an identity plus a history of everything the user has
// rated or saved, persisted to localStorage so it survives closing the
// tab. This is intentionally NOT an account system — there's no server,
// no password, nothing that syncs across devices. It's the honest version
// of "remembers you": a private, on-this-browser identity, framed as
// exactly that in the UI (see header.ts's profile popover).
//
// Two things this unlocks:
//   1. "Closing the tab doesn't forget everything" — ratings and a
//      watchlist persist across sessions.
//   2. The recommendation engine gets more to work with over time: every
//      title ever rated (not just this session's) is fed back into
//      engine.processResultRating() on every run, so a returning user's
//      very first batch is already informed by everything they've told
//      the app before, not a cold start every time.

import type { CatalogItem, Era, Genre, RatingValue, Vibe } from './types';

const STORAGE_KEY = 'cinematch.profile.v1';
const MAX_HISTORY = 400; // oldest entries drop off past this — plenty for scoring, bounded for storage

export interface HistoryEntry {
  id: number;
  tmdbType: 'movie' | 'tv';
  title: string;
  year: number;
  posterPath: string | null;
  genres: Genre[];
  vibe: Vibe[];
  language: string;
  era: Era;
  voteAverage: number;
  popularity: number;
  rating: RatingValue;
  ratedAt: number;
  source: 'calibration' | 'result';
}

export interface WatchlistEntry {
  id: number;
  tmdbType: 'movie' | 'tv';
  title: string;
  year: number;
  posterPath: string | null;
  addedAt: number;
}

export interface LocalProfile {
  version: 1;
  id: string;
  displayName: string;
  avatarColor: string;
  createdAt: number;
  lastVisitAt: number;
  history: HistoryEntry[];
  watchlist: WatchlistEntry[];
}

const AVATAR_COLORS = ['#a78bfa', '#22d3ee', '#f472b6', '#fbbf24', '#4ade80', '#f87171', '#60a5fa'];
const NAME_ADJECTIVES = ['Curious', 'Late-night', 'Weekend', 'Rainy-day', 'Popcorn', 'Marathon', 'Couch'];
const NAME_NOUNS = ['Viewer', 'Watcher', 'Cinephile', 'Binger', 'Critic'];

function randomId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `local-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

function randomName(): string {
  const adj = NAME_ADJECTIVES[Math.floor(Math.random() * NAME_ADJECTIVES.length)];
  const noun = NAME_NOUNS[Math.floor(Math.random() * NAME_NOUNS.length)];
  return `${adj} ${noun}`;
}

function freshProfile(): LocalProfile {
  const now = Date.now();
  return {
    version: 1,
    id: randomId(),
    displayName: randomName(),
    avatarColor: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)],
    createdAt: now,
    lastVisitAt: now,
    history: [],
    watchlist: [],
  };
}

/** localStorage throws in private-browsing/storage-disabled contexts —
 * every call here is guarded so a blocked profile degrades to
 * session-only behavior instead of crashing the app. */
function readRaw(): LocalProfile | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LocalProfile;
    if (parsed.version !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeRaw(profile: LocalProfile): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
    return true;
  } catch {
    return false;
  }
}

let cached: LocalProfile | null = null;
/** True once we've confirmed localStorage actually persisted a write —
 * lets the UI say "saved on this device" honestly instead of assuming. */
let persistenceConfirmed = false;

export function getProfile(): LocalProfile {
  if (cached) return cached;
  const existing = readRaw();
  if (existing) {
    cached = existing;
    persistenceConfirmed = true;
  } else {
    cached = freshProfile();
    persistenceConfirmed = writeRaw(cached);
  }
  cached.lastVisitAt = Date.now();
  writeRaw(cached);
  return cached;
}

export function isPersistenceAvailable(): boolean {
  getProfile();
  return persistenceConfirmed;
}

export function setDisplayName(name: string): void {
  const p = getProfile();
  p.displayName = name.trim().slice(0, 40) || p.displayName;
  writeRaw(p);
}

export function recordRating(item: CatalogItem, rating: RatingValue, source: 'calibration' | 'result'): void {
  const p = getProfile();
  const entry: HistoryEntry = {
    id: item.id,
    tmdbType: item.tmdbType,
    title: item.title,
    year: item.year,
    posterPath: item.posterPath,
    genres: item.genres,
    vibe: item.vibe,
    language: item.language,
    era: item.era,
    voteAverage: item.voteAverage,
    popularity: item.popularity,
    rating,
    ratedAt: Date.now(),
    source,
  };
  // Replace any earlier verdict on the same title rather than duplicating it.
  p.history = p.history.filter((h) => h.id !== item.id);
  p.history.push(entry);
  if (p.history.length > MAX_HISTORY) p.history = p.history.slice(p.history.length - MAX_HISTORY);
  writeRaw(p);
}

const VIBE_VALUES = new Set(['dark', 'light', 'intellectual', 'feelgood', 'epic']);

/** The calibration screen's seed list only carries id/title/year/poster —
 * genre/vibe tags live separately in `signalsBySeedId` (see
 * rating-pool.ts). Builds the same shape of history entry from that
 * thinner data so calibration ratings persist too, just with less TMDB
 * metadata (voteAverage/popularity default to 0, era/language unknown)
 * than a result-screen rating gets for free. */
export function recordSeedRating(
  seed: { id: number; title: string; year: number; tmdbType: 'movie' | 'tv'; posterPath: string | null },
  signals: string[],
  rating: RatingValue
): void {
  const p = getProfile();
  const entry: HistoryEntry = {
    id: seed.id,
    tmdbType: seed.tmdbType,
    title: seed.title,
    year: seed.year,
    posterPath: seed.posterPath,
    genres: signals.filter((s) => !VIBE_VALUES.has(s)) as Genre[],
    vibe: signals.filter((s) => VIBE_VALUES.has(s)) as Vibe[],
    language: 'en',
    era: 'any',
    voteAverage: 0,
    popularity: 0,
    rating,
    ratedAt: Date.now(),
    source: 'calibration',
  };
  p.history = p.history.filter((h) => h.id !== seed.id);
  p.history.push(entry);
  if (p.history.length > MAX_HISTORY) p.history = p.history.slice(p.history.length - MAX_HISTORY);
  writeRaw(p);
}

export function historyRatingFor(id: number): RatingValue | undefined {
  return getProfile().history.find((h) => h.id === id)?.rating;
}

/** Reconstructs a minimal CatalogItem from a history entry — just enough
 * for engine.processResultRating(), which only reads genres/vibe/
 * language/voteAverage/popularity/id off it. */
export function historyAsCatalogItems(): { item: CatalogItem; rating: RatingValue }[] {
  return getProfile().history.map((h) => ({
    rating: h.rating,
    item: {
      id: h.id,
      title: h.title,
      year: h.year,
      type: h.tmdbType === 'tv' ? 'series' : 'movie',
      tmdbType: h.tmdbType,
      posterPath: h.posterPath,
      backdropPath: null,
      genreIds: [],
      genres: h.genres,
      vibe: h.vibe,
      language: h.language,
      era: h.era,
      voteAverage: h.voteAverage,
      voteCount: 0,
      popularity: h.popularity,
      overview: '',
    },
  }));
}

export function isInWatchlist(id: number): boolean {
  return getProfile().watchlist.some((w) => w.id === id);
}

export function toggleWatchlist(item: CatalogItem): boolean {
  const p = getProfile();
  const already = p.watchlist.some((w) => w.id === item.id);
  if (already) {
    p.watchlist = p.watchlist.filter((w) => w.id !== item.id);
  } else {
    p.watchlist.unshift({
      id: item.id,
      tmdbType: item.tmdbType,
      title: item.title,
      year: item.year,
      posterPath: item.posterPath,
      addedAt: Date.now(),
    });
  }
  writeRaw(p);
  return !already;
}

export function removeFromWatchlist(id: number): void {
  const p = getProfile();
  p.watchlist = p.watchlist.filter((w) => w.id !== id);
  writeRaw(p);
}

export function getStats(): { ratedCount: number; watchlistCount: number; sinceDays: number } {
  const p = getProfile();
  return {
    ratedCount: p.history.length,
    watchlistCount: p.watchlist.length,
    sinceDays: Math.max(0, Math.floor((Date.now() - p.createdAt) / 86_400_000)),
  };
}

/** Explicit, user-initiated only — this is the one action in the whole
 * module that's destructive, so it's never called from anywhere but a
 * confirmed "Reset my data" click. */
export function resetProfile(): LocalProfile {
  cached = freshProfile();
  persistenceConfirmed = writeRaw(cached);
  return cached;
}
