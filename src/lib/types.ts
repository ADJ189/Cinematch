export type Screen = 'landing' | 'quiz' | 'rating' | 'results';

export type Genre = 'thriller' | 'comedy' | 'drama' | 'scifi' | 'horror' | 'adventure' | 'anime' | 'cartoon' | 'sitcom';
export type Vibe = 'dark' | 'light' | 'intellectual' | 'feelgood' | 'epic';
export type Era = 'classic' | 'mid' | 'recent' | 'any';
export type Format = 'movie' | 'series' | 'both';
export type Company = 'solo' | 'date' | 'friends' | 'family';
export type Language = 'english' | 'subtitles' | 'any_lang';
/** A separate style dimension from `mood` — lets someone ask specifically
 * for anime, Western animation, or sitcom-style comedy rather than
 * overloading the tone question. 'live_action' means no preference here. */
export type ContentType = 'anime' | 'cartoon' | 'sitcom' | 'live_action';
/** grouped = a wider, more forgiving pool (default). precise = fewer titles,
 * held to a higher match-score bar — quality over quantity. */
export type ResultsMode = 'grouped' | 'precise';

export interface QuizAnswers {
  mood?: Genre;
  format?: Format;
  era?: Era;
  vibe?: Vibe;
  company?: Company;
  language?: Language;
  contentType?: ContentType;
}

export interface QuizOption {
  label: string;
  value: string;
  icon: string;
}

export interface QuizQuestion {
  id: keyof QuizAnswers;
  question: string;
  subtitle: string;
  options: QuizOption[];
  /** Narrows/reorders this question's options based on answers already
   * given, so a later question doesn't offer something that contradicts
   * or just restates an earlier pick (e.g. "light & fun" after "horror"). */
  filterOptions?: (answers: QuizAnswers, options: QuizOption[]) => QuizOption[];
}

/** A title as returned live from TMDB's discover/search endpoints. */
export interface CatalogItem {
  id: number; // TMDB id, used as the canonical id throughout the app
  title: string;
  year: number;
  type: 'movie' | 'series';
  tmdbType: 'movie' | 'tv';
  posterPath: string | null;
  backdropPath: string | null;
  genreIds: number[];
  genres: Genre[]; // mapped to our internal genre vocabulary
  vibe: Vibe[]; // inferred from genre + keywords
  language: string; // ISO 639-1 original_language
  era: Era;
  voteAverage: number; // TMDB rating, 0-10
  voteCount: number;
  popularity: number;
  overview: string;
  externalRatings?: ExternalRatings;
}

export interface ExternalRatings {
  rottenTomatoes?: number; // 0-100
  metacritic?: number; // 0-100
  imdbRating?: number; // 0-10
}

export interface ScoredItem extends CatalogItem {
  matchPct: number;
  reasons: string[];
}

/** A small, well-known seed list used for the taste-calibration rating step. */
export interface RatingSeed {
  id: number; // TMDB id
  title: string;
  year: number;
  type: 'movie' | 'series';
  tmdbType: 'movie' | 'tv';
  posterPath: string | null;
}

export type RatingValue = 1 | 2 | 3 | 4 | 5;

export interface GenreAffinityMap {
  [key: string]: number;
}

export interface AppState {
  screen: Screen;
  quizAnswers: QuizAnswers;
  ratings: Record<number, RatingValue>;
  ratingSeeds: RatingSeed[];
  ratingSignals: Record<number, string[]>;
  results: ScoredItem[];
  loading: boolean;
  error: string | null;
}
