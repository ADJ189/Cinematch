// src/lib/store.ts
//
// A tiny pub-sub store. This is the entire "framework" the app needs —
// no reactivity compiler, no virtual DOM. Screens subscribe and re-render
// themselves on change.

import { RATING_SEEDS, SEED_SIGNALS } from '../data/rating-seeds';
import type { AppState, QuizAnswers, RatingValue, RatingSeed, ScoredItem, Screen } from './types';

type Listener = (state: AppState) => void;

function createStore() {
  let state: AppState = {
    screen: 'landing',
    quizAnswers: {},
    ratings: {},
    ratingSeeds: RATING_SEEDS,
    ratingSignals: SEED_SIGNALS,
    results: [],
    loading: false,
    error: null,
  };

  const listeners = new Set<Listener>();

  function notify() {
    for (const l of listeners) l(state);
  }

  return {
    getState: () => state,
    subscribe(listener: Listener): () => void {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
    setScreen(screen: Screen) {
      state = { ...state, screen, error: null };
      notify();
    },
    setQuizAnswers(answers: QuizAnswers) {
      state = { ...state, quizAnswers: answers };
      notify();
    },
    setRating(id: number, value: RatingValue) {
      state = { ...state, ratings: { ...state.ratings, [id]: value } };
      notify();
    },
    importRatings(ratings: Record<number, RatingValue>) {
      state = { ...state, ratings: { ...state.ratings, ...ratings } };
      notify();
    },
    /** Set once the rating screen finishes building its (possibly
     * genre-weighted) calibration list, so the results engine scores
     * against the same seeds/signals the user actually rated. */
    setRatingPool(seeds: RatingSeed[], signals: Record<number, string[]>) {
      state = { ...state, ratingSeeds: seeds, ratingSignals: signals };
      notify();
    },
    setLoading(loading: boolean) {
      state = { ...state, loading };
      notify();
    },
    setError(error: string | null) {
      state = { ...state, error, loading: false };
      notify();
    },
    setResults(results: ScoredItem[]) {
      state = { ...state, results, loading: false, error: null };
      notify();
    },
    reset() {
      state = {
        screen: 'landing',
        quizAnswers: {},
        ratings: {},
        ratingSeeds: RATING_SEEDS,
        ratingSignals: SEED_SIGNALS,
        results: [],
        loading: false,
        error: null,
      };
      notify();
    },
  };
}

export const store = createStore();
