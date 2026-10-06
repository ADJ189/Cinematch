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
import { safeGet, safeSet } from './storage';

const STORAGE_KEY = 'cinematch.profile.v1';
const MAX_HISTORY = 1000; // oldest entries drop off past this — plenty for scoring, bounded for storage

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
  /** Exact 0.5-5 rating when it came from an import (rating is its rounded 1-5 form). */
  stars?: number;
  ratedAt: number;
  source: 'calibration' | 'result' | 'import';
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
  /** Optional — when unset, the header falls back to the display name's
   * first letter (the original, simplest avatar). Picking one of
   * AVATAR_EMOJIS is entirely optional polish, never required. */
  avatarEmoji?: string;
  createdAt: number;
  lastVisitAt: number;
  history: HistoryEntry[];
  watchlist: WatchlistEntry[];
}

const AVATAR_COLORS = [
  '#a78bfa', '#22d3ee', '#f472b6', '#fbbf24', '#4ade80', '#f87171', '#60a5fa',
  '#c084fc', '#2dd4bf', '#fb923c', '#a3e635',
];
// A small, deliberately film-themed set rather than generic smileys —
// keeps the picker feeling like part of this app rather than a bolted-on
// generic avatar system.
export const AVATAR_EMOJIS = ['🎬', '🍿', '🎭', '👾', '🐉', '🚀', '🔮', '🕵️', '👻', '🦇', '🧙', '📼'];
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

const GENRE_VALUES = new Set(['thriller', 'comedy', 'drama', 'scifi', 'horror', 'adventure', 'anime', 'cartoon', 'sitcom']);
const ERA_VALUES = new Set(['classic', 'mid', 'recent', 'any']);

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);

function sanitizeHistoryEntry(raw: unknown): HistoryEntry | null {
  if (!isObj(raw)) return null;
  const id = num(raw.id, -1);
  const rating = num(raw.rating, 0);
  const tmdbType = raw.tmdbType === 'tv' ? 'tv' : raw.tmdbType === 'movie' ? 'movie' : null;
  if (id < 0 || !tmdbType || !Number.isInteger(rating) || rating < 1 || rating > 5) return null;
  const list = (v: unknown, allowed: Set<string>) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && allowed.has(x)) : [];
  return {
    id,
    tmdbType,
    title: str(raw.title, 'Untitled').slice(0, 200),
    year: num(raw.year),
    posterPath: typeof raw.posterPath === 'string' ? raw.posterPath : null,
    genres: list(raw.genres, GENRE_VALUES) as Genre[],
    vibe: list(raw.vibe, VIBE_VALUES) as Vibe[],
    language: str(raw.language, 'en').slice(0, 8),
    era: (ERA_VALUES.has(str(raw.era)) ? raw.era : 'any') as Era,
    voteAverage: num(raw.voteAverage),
    popularity: num(raw.popularity),
    rating: rating as RatingValue,
    stars: typeof raw.stars === 'number' && raw.stars >= 0.5 && raw.stars <= 5 ? raw.stars : undefined,
    ratedAt: num(raw.ratedAt, Date.now()),
    source: raw.source === 'calibration' ? 'calibration' : raw.source === 'import' ? 'import' : 'result',
  };
}

function sanitizeWatchlistEntry(raw: unknown): WatchlistEntry | null {
  if (!isObj(raw)) return null;
  const id = num(raw.id, -1);
  const tmdbType = raw.tmdbType === 'tv' ? 'tv' : raw.tmdbType === 'movie' ? 'movie' : null;
  if (id < 0 || !tmdbType) return null;
  return {
    id,
    tmdbType,
    title: str(raw.title, 'Untitled').slice(0, 200),
    year: num(raw.year),
    posterPath: typeof raw.posterPath === 'string' ? raw.posterPath : null,
    addedAt: num(raw.addedAt, Date.now()),
  };
}

/** Version-checking alone trusts whatever JSON happens to be in storage.
 * This rebuilds the profile field by field so a corrupted or hand-edited
 * entry degrades to safe defaults (and drops only the bad rows) instead
 * of crashing a screen that assumed the shape was right. */
function sanitizeProfile(raw: unknown): LocalProfile | null {
  if (!isObj(raw) || raw.version !== 1) return null;
  const base = freshProfile();
  const history = Array.isArray(raw.history)
    ? raw.history.map(sanitizeHistoryEntry).filter((h): h is HistoryEntry => h !== null)
    : [];
  const watchlist = Array.isArray(raw.watchlist)
    ? raw.watchlist.map(sanitizeWatchlistEntry).filter((w): w is WatchlistEntry => w !== null)
    : [];
  const emoji = typeof raw.avatarEmoji === 'string' && AVATAR_EMOJIS.includes(raw.avatarEmoji) ? raw.avatarEmoji : undefined;
  return {
    version: 1,
    id: str(raw.id) || base.id,
    displayName: str(raw.displayName).trim().slice(0, 40) || base.displayName,
    avatarColor: /^#[0-9a-fA-F]{6}$/.test(str(raw.avatarColor)) ? str(raw.avatarColor) : base.avatarColor,
    avatarEmoji: emoji,
    createdAt: num(raw.createdAt, base.createdAt),
    lastVisitAt: num(raw.lastVisitAt, base.lastVisitAt),
    history: history.slice(-MAX_HISTORY),
    watchlist,
  };
}

/** Storage can be blocked entirely (private browsing) — every access goes
 * through storage.ts, so a blocked profile degrades to session-only
 * behavior instead of crashing the app. */
function readRaw(): LocalProfile | null {
  const raw = safeGet(STORAGE_KEY);
  if (!raw) return null;
  try {
    return sanitizeProfile(JSON.parse(raw));
  } catch {
    return null;
  }
}

function writeRaw(profile: LocalProfile): boolean {
  try {
    return safeSet(STORAGE_KEY, JSON.stringify(profile));
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

export function setAvatar(color: string, emoji: string | undefined): void {
  const p = getProfile();
  p.avatarColor = color;
  p.avatarEmoji = emoji;
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

export function recordImportedRatings(entries: { item: CatalogItem; stars: number }[]): void {
  const p = getProfile();
  const byId = new Map(p.history.map((h) => [h.id, h]));
  for (const { item, stars } of entries) {
    // A rating the person gave deliberately in the app beats an imported one.
    const existing = byId.get(item.id);
    if (existing && existing.source !== 'import') continue;
    byId.set(item.id, {
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
      rating: Math.max(1, Math.min(5, Math.round(stars))) as RatingValue,
      stars,
      ratedAt: Date.now(),
      source: 'import',
    });
  }
  // Persist once for the whole batch, de-duplicated by TMDB id; the newest
  // entries win if the cap is exceeded.
  p.history = [...byId.values()].slice(-MAX_HISTORY);
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
export function historyAsCatalogItems(): { item: CatalogItem; rating: number; imported: boolean }[] {
  return getProfile().history.map((h) => ({
    rating: h.stars ?? h.rating,
    imported: h.source === 'import',
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
