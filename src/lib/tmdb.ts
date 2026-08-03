// src/lib/tmdb.ts
//
// Live TMDB connector. Replaces the old baked-in 30-title catalog: every
// query hits TMDB's /discover endpoints so results actually change with the
// user's answers instead of re-sorting the same fixed list.
//
// Auth: set VITE_TMDB_TOKEN (v4 read access token, preferred) or
// VITE_TMDB_KEY (v3 api key) in a local .env file. Neither is committed.

import type { CastMember, CatalogItem, Credits, ContentType, CrewMember, Era, Format, Genre, Language, PersonDetails, PersonSummary, Vibe } from './types';

const API_BASE = 'https://api.themoviedb.org/3';
const IMAGE_BASE = 'https://image.tmdb.org/t/p/';
const SIZES = { xs: 'w92', sm: 'w185', md: 'w342', lg: 'w500', xl: 'w780' } as const;
const REQUEST_TIMEOUT_MS = 9_000;

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

// Session-lifetime cache, keyed by the fully-built request URL. TMDB data
// for a given id/query is effectively static for the length of one visit
// (a title's cast, ratings, and similar-titles list don't change minute
// to minute), and several flows can request the exact same URL more than
// once — reopening a detail modal, retyping a search query you already
// ran, switching back to a title you just viewed. `inflight` also
// collapses concurrent duplicate requests (e.g. two UI elements both
// asking for the same title's watch providers on the same render) into
// one network call instead of two.
const responseCache = new Map<string, unknown>();
const inflight = new Map<string, Promise<unknown>>();
const CACHE_MAX = 300; // bounds memory on a very long session; oldest entries drop first

/**
 * Fetches with a hard timeout and one retry. Mobile networks in particular
 * stall requests far more often than they hard-fail them — without a
 * timeout, a single slow request could leave the results screen hanging
 * indefinitely even though five other requests already came back fine.
 */
async function tmdbFetch<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${API_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  if (!TOKEN && KEY) url.searchParams.set('api_key', KEY);
  const cacheKey = url.toString();

  const cached = responseCache.get(cacheKey);
  if (cached !== undefined) return cached as T;

  const existing = inflight.get(cacheKey);
  if (existing) return existing as Promise<T>;

  const promise = tmdbFetchUncached<T>(cacheKey).finally(() => inflight.delete(cacheKey));
  inflight.set(cacheKey, promise);

  const result = await promise;
  if (responseCache.size >= CACHE_MAX) {
    const oldest = responseCache.keys().next().value;
    if (oldest !== undefined) responseCache.delete(oldest);
  }
  responseCache.set(cacheKey, result);
  return result;
}

async function tmdbFetchUncached<T>(url: string): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {},
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`TMDB ${res.status}: ${url}`);
      return (await res.json()) as T;
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`TMDB request failed: ${url}`);
}

// ── Genre mapping ────────────────────────────────────────────────────────
// TMDB genre ids differ slightly between movie and tv. We map both onto our
// small internal vocabulary so quiz answers can filter either. Genre 16
// (Animation, same id on both movie and tv) is handled separately below
// since which internal tag it becomes — anime vs. cartoon — depends on
// original language, not the id alone.
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

const ANIMATION_GENRE_ID = 16;
const TV_COMEDY_GENRE_ID = 35;

// Reverse lookup for building TMDB `with_genres` discover filters.
const GENRE_TO_TMDB_MOVIE: Record<Genre, number> = {
  thriller: 53, comedy: 35, drama: 18, scifi: 878, horror: 27, adventure: 12,
  anime: ANIMATION_GENRE_ID, cartoon: ANIMATION_GENRE_ID, sitcom: TV_COMEDY_GENRE_ID,
};
const GENRE_TO_TMDB_TV: Record<Genre, number> = {
  thriller: 9648, comedy: 35, drama: 18, scifi: 10765, horror: 27, adventure: 10759,
  anime: ANIMATION_GENRE_ID, cartoon: ANIMATION_GENRE_ID, sitcom: TV_COMEDY_GENRE_ID,
};

function mapGenres(ids: number[], type: 'movie' | 'tv', originalLanguage: string): Genre[] {
  const map = type === 'movie' ? MOVIE_GENRE_MAP : TV_GENRE_MAP;
  const out = new Set<Genre>();
  for (const id of ids) {
    if (id === ANIMATION_GENRE_ID) {
      out.add(originalLanguage === 'ja' ? 'anime' : 'cartoon');
      continue;
    }
    if (type === 'tv' && id === TV_COMEDY_GENRE_ID) {
      out.add('comedy');
      out.add('sitcom');
      continue;
    }
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
  if (genres.includes('comedy') || genres.includes('sitcom')) out.add('light');
  if (genres.includes('drama') && voteAverage >= 7.5) out.add('intellectual');
  if (genres.includes('comedy') || genres.includes('sitcom') || (genres.includes('drama') && voteAverage >= 7)) {
    out.add('feelgood');
  }
  if (genres.includes('adventure') || genres.includes('scifi') || genres.includes('anime')) out.add('epic');
  if (genres.includes('cartoon')) out.add('light');
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

  const genres = mapGenres(raw.genre_ids ?? [], tmdbType, raw.original_language);
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
  contentType?: ContentType;
}

/** Genre ids implied by contentType, on top of whatever `mood` already set.
 * Combined with mood's id via AND (TMDB's comma-joined `with_genres`) — e.g.
 * mood=comedy + contentType=cartoon asks for animated comedies specifically,
 * not just "anything animated OR anything funny". */
function contentTypeGenreId(contentType: ContentType | undefined): number | null {
  if (contentType === 'anime' || contentType === 'cartoon') return ANIMATION_GENRE_ID;
  if (contentType === 'sitcom') return TV_COMEDY_GENRE_ID;
  return null;
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
  // Sitcom is inherently a TV concept — force series-only regardless of the
  // quiz's format answer rather than wasting a request on "sitcom movies".
  const wantMovies = filters.format !== 'series' && filters.contentType !== 'sitcom';
  const wantSeries = filters.format !== 'movie';

  const eraRange: Record<Era, [string, string] | null> = {
    classic: ['1900-01-01', '1999-12-31'],
    mid: ['2000-01-01', '2015-12-31'],
    recent: ['2016-01-01', new Date().toISOString().slice(0, 10)],
    any: null,
  };

  const extraGenreId = contentTypeGenreId(filters.contentType);

  const jobs: Promise<CatalogItem[]>[] = [];

  if (wantMovies) {
    const params: Record<string, string> = {
      sort_by: 'popularity.desc',
      'vote_count.gte': '150',
      include_adult: 'false',
    };
    const genreIds = new Set<number>();
    if (filters.mood) genreIds.add(GENRE_TO_TMDB_MOVIE[filters.mood]);
    if (extraGenreId) genreIds.add(extraGenreId);
    if (genreIds.size) params.with_genres = [...genreIds].join(',');

    const range = filters.era ? eraRange[filters.era] : null;
    if (range) {
      params['primary_release_date.gte'] = range[0];
      params['primary_release_date.lte'] = range[1];
    }
    if (filters.contentType === 'anime') params.with_original_language = 'ja';
    else if (filters.language === 'english') params.with_original_language = 'en';

    jobs.push(fetchDiscoverPages('/discover/movie', params, 'movie', pageOffset));
  }

  if (wantSeries) {
    const params: Record<string, string> = {
      sort_by: 'popularity.desc',
      'vote_count.gte': '100',
      include_adult: 'false',
    };
    const genreIds = new Set<number>();
    if (filters.mood) genreIds.add(GENRE_TO_TMDB_TV[filters.mood]);
    if (extraGenreId) genreIds.add(extraGenreId);
    if (genreIds.size) params.with_genres = [...genreIds].join(',');

    const range = filters.era ? eraRange[filters.era] : null;
    if (range) {
      params['first_air_date.gte'] = range[0];
      params['first_air_date.lte'] = range[1];
    }
    if (filters.contentType === 'anime') params.with_original_language = 'ja';
    else if (filters.language === 'english') params.with_original_language = 'en';

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

interface TmdbMultiSearchRaw extends TmdbRawResult {
  media_type: 'movie' | 'tv' | 'person';
}

/**
 * Free-text search across movies and TV in one call, for the "search a
 * title" screen. Filters out `person` results (TMDB's /search/multi mixes
 * actors/directors into the same endpoint) and anything with too few
 * votes to be a meaningful search match, but keeps the threshold low
 * (unlike discoverCandidates' 100-150) since a direct name search should
 * still surface a title the user is specifically looking for even if
 * it's obscure.
 */
export async function searchMulti(query: string): Promise<CatalogItem[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const data = await tmdbFetch<{ results: TmdbMultiSearchRaw[] }>('/search/multi', {
    query: trimmed,
    include_adult: 'false',
  });
  const items: CatalogItem[] = [];
  for (const raw of data.results) {
    if (raw.media_type !== 'movie' && raw.media_type !== 'tv') continue;
    const item = toCatalogItem(raw, raw.media_type);
    if (item) items.push(item);
  }
  return items;
}

/**
 * "People don't have the same taste every time" — rather than run a
 * single title through our own quiz-calibrated genre/vibe engine (which
 * is tuned for *this user's* stated preferences, not for "what's
 * actually similar to this specific title"), this defers to TMDB's own
 * similarity data: /recommendations (collaborative-filtering — what
 * users who engaged with this title also engaged with) merged with
 * /similar (genre/keyword/cast overlap) as a fallback for when
 * recommendations is thin, which it often is for less mainstream titles.
 * Deduped, with the source title itself excluded.
 */
export async function getSimilarTitles(id: number, tmdbType: 'movie' | 'tv'): Promise<CatalogItem[]> {
  const [recs, similar] = await Promise.all([
    tmdbFetch<{ results: TmdbRawResult[] }>(`/${tmdbType}/${id}/recommendations`, {}).catch(() => ({ results: [] })),
    tmdbFetch<{ results: TmdbRawResult[] }>(`/${tmdbType}/${id}/similar`, {}).catch(() => ({ results: [] })),
  ]);

  const seen = new Set<number>([id]);
  const items: CatalogItem[] = [];
  // Recommendations first — it's the stronger signal — similar only fills gaps.
  for (const raw of [...recs.results, ...similar.results]) {
    if (seen.has(raw.id)) continue;
    seen.add(raw.id);
    const item = toCatalogItem(raw, tmdbType);
    if (item) items.push(item);
  }
  return items;
}

export interface WatchProvider {
  name: string;
  logoPath: string | null;
}

export interface WatchProviders {
  region: string;
  link: string | null;
  stream: WatchProvider[];
  rent: WatchProvider[];
  buy: WatchProvider[];
}

interface TmdbWatchProviderRaw {
  provider_name: string;
  logo_path: string | null;
}

interface TmdbWatchProvidersRaw {
  link: string;
  flatrate?: TmdbWatchProviderRaw[];
  rent?: TmdbWatchProviderRaw[];
  buy?: TmdbWatchProviderRaw[];
}

/**
 * TMDB's /watch/providers is powered by JustWatch and is region-locked —
 * results genuinely differ by country because of licensing, so this asks
 * the browser for its locale (e.g. "en-US" → "US") rather than assuming
 * one region for everyone. Falls back to US, the largest single dataset,
 * when the locale can't be read as a country. Availability data is
 * provided by JustWatch via TMDB, not guaranteed complete or current —
 * always paired with a "check {provider}" link, never presented as a
 * standalone purchase/play action.
 */
export async function getWatchProviders(id: number, tmdbType: 'movie' | 'tv'): Promise<WatchProviders | null> {
  const region = guessRegion();
  try {
    const data = await tmdbFetch<{ results: Record<string, TmdbWatchProvidersRaw> }>(
      `/${tmdbType}/${id}/watch/providers`,
      {}
    );
    const entry = data.results[region] ?? data.results.US;
    if (!entry) return null;
    const toList = (arr?: TmdbWatchProviderRaw[]): WatchProvider[] =>
      (arr ?? []).map((p) => ({ name: p.provider_name, logoPath: p.logo_path }));
    return {
      region: data.results[region] ? region : 'US',
      link: entry.link ?? null,
      stream: toList(entry.flatrate),
      rent: toList(entry.rent),
      buy: toList(entry.buy),
    };
  } catch {
    return null;
  }
}

function guessRegion(): string {
  try {
    const locale = navigator.languages?.[0] ?? navigator.language;
    const parts = locale.split('-');
    const region = parts[1]?.toUpperCase();
    return region && region.length === 2 ? region : 'US';
  } catch {
    return 'US';
  }
}

export function providerLogoUrl(logoPath: string | null): string | null {
  if (!logoPath) return null;
  return `${IMAGE_BASE}w92${logoPath}`;
}

export function personImageUrl(profilePath: string | null): string | null {
  if (!profilePath) return null;
  return `${IMAGE_BASE}w185${profilePath}`;
}

interface TmdbPersonSearchRaw {
  id: number;
  name: string;
  profile_path: string | null;
  known_for_department: string;
}

/** Search for a person (actor, director, etc.) by name. Kept separate
 * from searchMulti() rather than folded in — a title search and a
 * person search want different follow-up actions (similar titles vs. a
 * filmography), so the search screen treats them as parallel result
 * lists rather than one merged, type-ambiguous list. */
export async function searchPeople(query: string): Promise<PersonSummary[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const data = await tmdbFetch<{ results: TmdbPersonSearchRaw[] }>('/search/person', {
    query: trimmed,
    include_adult: 'false',
  });
  return data.results
    .filter((p) => p.known_for_department) // filters out near-empty/junk entries
    .map((p) => ({ id: p.id, name: p.name, profilePath: p.profile_path, knownForDepartment: p.known_for_department }));
}

interface TmdbCastRaw {
  id: number;
  name: string;
  character: string;
  profile_path: string | null;
  order: number;
}
interface TmdbCrewRaw {
  id: number;
  name: string;
  job: string;
  profile_path: string | null;
}
interface TmdbCreatedByRaw {
  id: number;
  name: string;
  profile_path: string | null;
}

/**
 * Cast + director(s)/creator(s) for one title. Movies carry directors in
 * the crew list (job === 'Director'); TV shows put creators in a
 * separate top-level `created_by` field instead — TMDB's schema
 * genuinely differs here, not an oversight, so both are checked.
 */
export async function getCredits(id: number, tmdbType: 'movie' | 'tv'): Promise<Credits> {
  const data = await tmdbFetch<{
    cast: TmdbCastRaw[];
    crew: TmdbCrewRaw[];
    created_by?: TmdbCreatedByRaw[];
  }>(`/${tmdbType}/${id}/credits`, {});

  const cast: CastMember[] = [...data.cast]
    .sort((a, b) => a.order - b.order)
    .slice(0, 12)
    .map((c) => ({ id: c.id, name: c.name, character: c.character, profilePath: c.profile_path }));

  const directors: CrewMember[] =
    tmdbType === 'movie'
      ? data.crew
          .filter((c) => c.job === 'Director')
          .map((c) => ({ id: c.id, name: c.name, job: 'Director', profilePath: c.profile_path }))
      : (data.created_by ?? []).map((c) => ({ id: c.id, name: c.name, job: 'Creator', profilePath: c.profile_path }));

  return { cast, directors };
}

interface TmdbPersonDetailsRaw {
  id: number;
  name: string;
  profile_path: string | null;
  known_for_department: string;
  biography: string;
  birthday: string | null;
  place_of_birth: string | null;
}

interface TmdbCombinedCreditRaw extends TmdbRawResult {
  media_type: 'movie' | 'tv';
}

export async function getPersonDetails(id: number): Promise<PersonDetails> {
  const p = await tmdbFetch<TmdbPersonDetailsRaw>(`/person/${id}`, {});
  return {
    id: p.id,
    name: p.name,
    profilePath: p.profile_path,
    knownForDepartment: p.known_for_department,
    biography: p.biography,
    birthday: p.birthday,
    placeOfBirth: p.place_of_birth,
  };
}

interface TmdbDetailsRaw extends Omit<TmdbRawResult, 'genre_ids'> {
  genres: { id: number; name: string }[];
}

/** Resolves a bare (id, tmdbType) to a full CatalogItem — needed when
 * navigation only carries an id, e.g. jumping to a title from a person's
 * filmography or a "pending search target" set by another screen.
 * /movie/{id} and /tv/{id} return `genres` as {id,name} objects rather
 * than the bare id array /discover and /search return, so this adapts
 * that shape before reusing the same toCatalogItem() mapper. */
export async function getTitleDetails(id: number, tmdbType: 'movie' | 'tv'): Promise<CatalogItem | null> {
  const raw = await tmdbFetch<TmdbDetailsRaw>(`/${tmdbType}/${id}`, {});
  return toCatalogItem({ ...raw, genre_ids: raw.genres.map((g) => g.id) }, tmdbType);
}

/**
 * A person's best-known work, for the "best movies & shows" section of
 * their page — ranked by vote average with a vote-count floor (so a
 * one-review 9.8 short film doesn't outrank a broadly-loved title), the
 * same reasoning discoverCandidates() already applies elsewhere.
 */
export async function getPersonBestWork(id: number, limit = 12): Promise<CatalogItem[]> {
  const data = await tmdbFetch<{ cast: TmdbCombinedCreditRaw[]; crew: TmdbCombinedCreditRaw[] }>(
    `/person/${id}/combined_credits`,
    {}
  );
  const seen = new Set<number>();
  const items: CatalogItem[] = [];
  for (const raw of [...data.cast, ...data.crew]) {
    if (seen.has(raw.id) || raw.vote_count < 50) continue;
    seen.add(raw.id);
    const item = toCatalogItem(raw, raw.media_type);
    if (item) items.push(item);
  }
  return items.sort((a, b) => b.voteAverage - a.voteAverage).slice(0, limit);
}
