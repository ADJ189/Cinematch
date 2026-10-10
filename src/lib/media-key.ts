// src/lib/media-key.ts
//
// TMDB numbers movies and TV shows from separate sequences, so id 1399 can
// be both a film and a series. Every selection, rating, watchlist entry,
// cache key and signal map therefore keys on `mediaType:id` — never on the
// bare number. One helper, used everywhere, so no screen invents its own
// mapping.

export type TmdbMediaType = 'movie' | 'tv';
export type MediaKey = `${TmdbMediaType}:${number}`;

export function mediaKey(tmdbType: TmdbMediaType, id: number): MediaKey {
  return `${tmdbType}:${id}`;
}

export function keyOf(item: { id: number; tmdbType: TmdbMediaType }): MediaKey {
  return mediaKey(item.tmdbType, item.id);
}

/** Parses a key back out; returns null for anything malformed. */
export function parseMediaKey(key: string): { tmdbType: TmdbMediaType; id: number } | null {
  const m = /^(movie|tv):(\d+)$/.exec(key);
  if (!m) return null;
  return { tmdbType: m[1] as TmdbMediaType, id: Number(m[2]) };
}

/** Safe for use inside a CSS attribute selector value (keys are already
 * [a-z0-9:] only, but keep the guard so a future key shape can't break it). */
export function keySelector(key: string): string {
  return `[data-item="${key.replace(/"/g, '')}"]`;
}
