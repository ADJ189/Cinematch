// src/lib/tmdb.ts
//
// Live TMDB connector. Replaces the old baked-in 30-title catalog: every
// query hits TMDB's /discover endpoints so results actually change with the
// user's answers instead of re-sorting the same fixed list.
//
// Auth: set VITE_TMDB_TOKEN (v4 read access token, preferred) or
// VITE_TMDB_KEY (v3 api key) in a local .env file. Neither is committed.

import type { CatalogItem, Era, Format, Genre, Language, Vibe } from './types';

const API_BASE = 'https://api.themoviedb.org/3';
const IMAGE_BASE = 'https://image.tmdb.org/t/p/';
const SIZES = { sm: 'w185', md: 'w342', lg: 'w500', xl: 'w780' } as const;

const TOKEN = import.meta.env.VITE_TMDB_TOKEN ?? '';
const KEY = import.meta.env.VITE_TMDB_KEY ?? '';

export const isTmdbConfigured = Boolean(TOKEN || KEY);

export function posterUrl(path: string | null, size: keyof typeof SIZES = 'lg'): string | null {
  if (!path) return null;
  return `${IMAGE_BASE}${SIZES[size]}${path}`;
}

export function backdropUrl(path: string | null): string | null {
  if (!path) return null;
  return `${IMAGE_BASE}${SIZES.xl}${path}`;
}

/** Public TMDB page for a title — used by the "check before you watch" detail view. */
export function tmdbDetailsUrl(id: number, tmdbType: 'movie' | 'tv'): string {
  return `https://www.themoviedb.org/${tmdbType}/${id}`;
}

async function tmdbFetch<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${API_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  if (!TOKEN && KEY) url.searchParams.set('api_key', KEY);

  const res = await fetch(url.toString(), {
    headers: TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {},
  });
  if (!res.ok) throw new Error(`TMDB ${res.status}: ${path}`);
  return res.json() as Promise<T>;
}

// ── Genre mapping ────────────────────────────────────────────────────────
// TMDB genre ids differ slightly between movie and tv. We map both onto our
// small internal vocabulary so quiz answers can filter either.
const MOVIE_GENRE_MAP: Record<number, Genre> = {
  53: 'thriller', 9648: 'thriller',
  35: 'comedy',
  18: 'drama',
  878: 'scifi', 14: 'scifi',
  27: 'horror',
  12: 'adventure', 28: 'adventure', 10752: 'adventure',
};

const TV_GENRE_MAP: Record<number, Genre> = {
  9648: 'thriller', 80: 'thriller',
  35: 'comedy',
  18: 'drama',
  10765: 'scifi',
  27: 'horror',
  10759: 'adventure',
};

// Reverse lookup for building TMDB `with_genres` discover filters.
const GENRE_TO_TMDB_MOVIE: Record<Genre, number> = {
  thriller: 53, comedy: 35, drama: 18, scifi: 878, horror: 27, adventure: 12,
};
const GENRE_TO_TMDB_TV: Record<Genre, number> = {
  thriller: 9648, comedy: 35, drama: 18, scifi: 10765, horror: 27, adventure: 10759,
};

function mapGenres(ids: number[], type: 'movie' | 'tv'): Genre[] {
  const map = type === 'movie' ? MOVIE_GENRE_MAP : TV_GENRE_MAP;
  const out = new Set<Genre>();
  for (const id of ids) {
    const g = map[id];
    if (g) out.add(g);
  }
  return [...out];
}

// Vibe is inferred (TMDB has no direct equivalent) from genre combinations
// and vote average, so every item still gets a usable vibe signal.
function inferVibe(genres: Genre[], voteAverage: number, popularity: number): Vibe[] {
  const out = new Set<Vibe>();
  if (genres.includes('horror') || genres.includes('thriller')) out.add('dark');
  if (genres.includes('comedy')) out.add('light');
  if (genres.includes('drama') && voteAverage >= 7.5) out.add('intellectual');
  if (genres.includes('comedy') || (genres.includes('drama') && voteAverage >= 7)) out.add('feelgood');
  if (genres.includes('adventure') || genres.includes('scifi')) out.add('epic');
  if (out.size === 0) out.add(voteAverage >= 7.5 ? 'intellectual' : 'light');
  void popularity;
  return [...out];
}

function classifyEra(year: number): Era {
  if (year < 2000) return 'classic';
  if (year < 2016) return 'mid';
  return 'recent';
}

interface TmdbRawResult {
  id: number;
  title?: string;
  name?: string;
  release_date?: string;
  first_air_date?: string;
  poster_path: string | null;
  backdrop_path: string | null;
  genre_ids: number[];
  original_language: string;
  vote_average: number;
  vote_count: number;
  popularity: number;
  overview: string;
}

function toCatalogItem(raw: TmdbRawResult, tmdbType: 'movie' | 'tv'): CatalogItem | null {
  const title = raw.title ?? raw.name;
  const dateStr = raw.release_date ?? raw.first_air_date;
  if (!title || !dateStr) return null;
  const year = Number(dateStr.slice(0, 4));
  if (!year) return null;

  const genres = mapGenres(raw.genre_ids ?? [], tmdbType);
  return {
    id: raw.id,
    title,
    year,
    type: tmdbType === 'movie' ? 'movie' : 'series',
    tmdbType,
    posterPath: raw.poster_path,
    backdropPath: raw.backdrop_path,
    genreIds: raw.genre_ids ?? [],
    genres,
    vibe: inferVibe(genres, raw.vote_average, raw.popularity),
    language: raw.original_language,
    era: classifyEra(year),
    voteAverage: raw.vote_average,
    voteCount: raw.vote_count,
    popularity: raw.popularity,
    overview: raw.overview,
  };
}

export interface DiscoverFilters {
  mood?: Genre;
  vibe?: Vibe;
  era?: Era;
  format?: Format;
  language?: Language;
}

/**
 * Pulls a live candidate pool from TMDB across up to 3 pages per media type,
 * filtered server-side by genre/era/language where TMDB supports it. This is
 * the fix for "same recommendations every time" — the pool is now hundreds
 * of titles wide and actually shifts with the quiz answers, instead of a
 * fixed 30-item array re-sorted in place.
 *
 * `pageOffset` shifts the page window forward (e.g. offset 3 pulls pages
 * 4-6 instead of 1-3) so "show me different picks" can pull a genuinely
 * new batch from TMDB instead of re-sorting the same candidates.
 */
export async function discoverCandidates(
  filters: DiscoverFilters,
  pageOffset = 0
): Promise<CatalogItem[]> {
  const wantMovies = filters.format !== 'series';
  const wantSeries = filters.format !== 'movie';

  const eraRange: Record<Era, [string, string] | null> = {
    classic: ['1900-01-01', '1999-12-31'],
    mid: ['2000-01-01', '2015-12-31'],
    recent: ['2016-01-01', new Date().toISOString().slice(0, 10)],
    any: null,
  };

  const jobs: Promise<CatalogItem[]>[] = [];

  if (wantMovies) {
    const params: Record<string, string> = {
      sort_by: 'popularity.desc',
      'vote_count.gte': '150',
      include_adult: 'false',
    };
    if (filters.mood) params.with_genres = String(GENRE_TO_TMDB_MOVIE[filters.mood]);
    const range = filters.era ? eraRange[filters.era] : null;
    if (range) {
      params['primary_release_date.gte'] = range[0];
      params['primary_release_date.lte'] = range[1];
    }
    if (filters.language === 'english') params.with_original_language = 'en';

    jobs.push(fetchDiscoverPages('/discover/movie', params, 'movie', pageOffset));
  }

  if (wantSeries) {
    const params: Record<string, string> = {
      sort_by: 'popularity.desc',
      'vote_count.gte': '100',
      include_adult: 'false',
    };
    if (filters.mood) params.with_genres = String(GENRE_TO_TMDB_TV[filters.mood]);
    const range = filters.era ? eraRange[filters.era] : null;
    if (range) {
      params['first_air_date.gte'] = range[0];
      params['first_air_date.lte'] = range[1];
    }
    if (filters.language === 'english') params.with_original_language = 'en';

    jobs.push(fetchDiscoverPages('/discover/tv', params, 'tv', pageOffset));
  }

  const results = await Promise.all(jobs);
  return results.flat();
}

async function fetchDiscoverPages(
  path: string,
  params: Record<string, string>,
  tmdbType: 'movie' | 'tv',
  pageOffset = 0
): Promise<CatalogItem[]> {
  const pages = await Promise.all(
    [1, 2, 3].map((page) =>
      tmdbFetch<{ results: TmdbRawResult[] }>(path, { ...params, page: String(page + pageOffset) }).catch(
        () => ({ results: [] })
      )
    )
  );
  const items: CatalogItem[] = [];
  for (const page of pages) {
    for (const raw of page.results) {
      const item = toCatalogItem(raw, tmdbType);
      if (item) items.push(item);
    }
  }
  return items;
}

/** Used by the rating step to resolve a small, well-known seed list to live posters/ids. */
export async function searchTitle(
  title: string,
  tmdbType: 'movie' | 'tv'
): Promise<{ id: number; posterPath: string | null } | null> {
  const path = tmdbType === 'movie' ? '/search/movie' : '/search/tv';
  const data = await tmdbFetch<{ results: TmdbRawResult[] }>(path, { query: title });
  const first = data.results[0];
  if (!first) return null;
  return { id: first.id, posterPath: first.poster_path };
}
