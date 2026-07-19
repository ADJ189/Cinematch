import type { RatingSeed } from '../lib/types';

// A small, deliberately well-known set used only to calibrate taste before
// the live TMDB query runs. These are NOT the recommendation pool — that's
// fetched live in lib/tmdb.ts. IDs are real TMDB ids.
export const RATING_SEEDS: RatingSeed[] = [
  { id: 155, title: 'The Dark Knight', year: 2008, type: 'movie', tmdbType: 'movie', posterPath: null },
  { id: 680, title: 'Pulp Fiction', year: 1994, type: 'movie', tmdbType: 'movie', posterPath: null },
  { id: 299534, title: 'Avengers: Endgame', year: 2019, type: 'movie', tmdbType: 'movie', posterPath: null },
  { id: 66732, title: 'Stranger Things', year: 2016, type: 'series', tmdbType: 'tv', posterPath: null },
  { id: 1399, title: 'Game of Thrones', year: 2011, type: 'series', tmdbType: 'tv', posterPath: null },
  { id: 603, title: 'The Matrix', year: 1999, type: 'movie', tmdbType: 'movie', posterPath: null },
  { id: 93405, title: 'Squid Game', year: 2021, type: 'series', tmdbType: 'tv', posterPath: null },
  { id: 313369, title: 'La La Land', year: 2016, type: 'movie', tmdbType: 'movie', posterPath: null },
  { id: 274, title: 'The Silence of the Lambs', year: 1991, type: 'movie', tmdbType: 'movie', posterPath: null },
  { id: 1668, title: 'Friends', year: 1994, type: 'series', tmdbType: 'tv', posterPath: null },
  { id: 597, title: 'Titanic', year: 1997, type: 'movie', tmdbType: 'movie', posterPath: null },
  { id: 120, title: 'The Lord of the Rings: The Fellowship of the Ring', year: 2001, type: 'movie', tmdbType: 'movie', posterPath: null },
  { id: 424, title: "Schindler's List", year: 1993, type: 'movie', tmdbType: 'movie', posterPath: null },
  { id: 13, title: 'Forrest Gump', year: 1994, type: 'movie', tmdbType: 'movie', posterPath: null },
  { id: 1398, title: 'The Sopranos', year: 1999, type: 'series', tmdbType: 'tv', posterPath: null },
];

// Genre/vibe tags per seed, used by the engine to translate a rating into
// taste signal without needing a live lookup.
export const SEED_SIGNALS: Record<number, string[]> = {
  155: ['thriller', 'dark', 'epic'],
  680: ['thriller', 'dark', 'intellectual'],
  299534: ['adventure', 'epic', 'feelgood'],
  66732: ['scifi', 'thriller', 'dark'],
  1399: ['drama', 'adventure', 'dark', 'epic'],
  603: ['scifi', 'thriller', 'intellectual'],
  93405: ['thriller', 'dark'],
  313369: ['drama', 'comedy', 'feelgood', 'light'],
  274: ['thriller', 'dark', 'intellectual'],
  1668: ['comedy', 'feelgood', 'light'],
  597: ['drama', 'feelgood'],
  120: ['adventure', 'epic', 'feelgood'],
  424: ['drama', 'dark', 'intellectual'],
  13: ['drama', 'feelgood', 'light'],
  1398: ['drama', 'thriller', 'dark'],
};
