import type { QuizQuestion, QuizAnswers, QuizOption } from '../lib/types';

// Options that would directly contradict or just restate the mood answer,
// keyed by mood — used to narrow the vibe question so it never asks
// something like "light & fun" right after "scared & screaming".
const VIBE_EXCLUDE_BY_MOOD: Partial<Record<string, string[]>> = {
  horror: ['feelgood', 'light'],
  thriller: ['feelgood', 'light'],
  comedy: ['dark'],
  sitcom: ['dark'],
};

function filterVibeOptions(answers: QuizAnswers, options: QuizOption[]): QuizOption[] {
  const exclude = answers.mood ? VIBE_EXCLUDE_BY_MOOD[answers.mood] : undefined;
  if (!exclude) return options;
  const filtered = options.filter((o) => !exclude.includes(o.value));
  // Never leave fewer than two choices — if a mood somehow excludes almost
  // everything, fall back to the full list rather than a near-empty one.
  return filtered.length >= 2 ? filtered : options;
}

export const QUIZ_QUESTIONS: QuizQuestion[] = [
  {
    id: 'mood',
    question: "What's your mood?",
    subtitle: 'Pick the feeling you want tonight',
    options: [
      { label: 'Thrilled & on-edge', value: 'thriller', icon: '⚡' },
      { label: 'Laughing out loud', value: 'comedy', icon: '😂' },
      { label: 'Deeply moved', value: 'drama', icon: '💔' },
      { label: 'Mind completely blown', value: 'scifi', icon: '🚀' },
      { label: 'Scared & screaming', value: 'horror', icon: '👻' },
      { label: 'Epic adventure', value: 'adventure', icon: '🗺️' },
    ],
  },
  {
    id: 'format',
    question: 'Movie or series?',
    subtitle: 'One sitting, or a whole binge',
    options: [
      { label: 'Movie — done in one sitting', value: 'movie', icon: '🎬' },
      { label: 'Series — binge-worthy', value: 'series', icon: '📺' },
      { label: 'No preference', value: 'both', icon: '🌀' },
    ],
  },
  {
    id: 'era',
    question: 'Any era preference?',
    subtitle: 'When was it made',
    options: [
      { label: 'Classic — pre-2000', value: 'classic', icon: '🎞️' },
      { label: '2000 – 2015', value: 'mid', icon: '📼' },
      { label: 'Recent — 2016+', value: 'recent', icon: '✨' },
      { label: 'No preference', value: 'any', icon: '🌀' },
    ],
  },
  {
    id: 'vibe',
    question: 'Pick your vibe',
    subtitle: 'The overall tone',
    options: [
      { label: 'Dark & gritty', value: 'dark', icon: '🌑' },
      { label: 'Light & fun', value: 'light', icon: '☀️' },
      { label: 'Thought-provoking', value: 'intellectual', icon: '🧠' },
      { label: 'Feel-good & warm', value: 'feelgood', icon: '🌈' },
      { label: 'Epic & grand', value: 'epic', icon: '🏔️' },
    ],
    filterOptions: filterVibeOptions,
  },
  {
    id: 'language',
    question: 'Language preference?',
    subtitle: 'Subtitles OK, or English only',
    options: [
      { label: 'English only', value: 'english', icon: '🔤' },
      { label: 'Subtitles are fine', value: 'subtitles', icon: '💬' },
      { label: 'No preference', value: 'any_lang', icon: '🌀' },
    ],
  },
  {
    id: 'contentType',
    question: 'One more thing — any particular style?',
    subtitle: 'Akinator mode: pick whatever fits, or skip if it\u2019s all fair game',
    options: [
      { label: 'Anime', value: 'anime', icon: '\ud83c\udf8c' },
      { label: 'Cartoon / animated', value: 'cartoon', icon: '\ud83c\udfa8' },
      { label: 'Sitcom energy', value: 'sitcom', icon: '\ud83d\udecb\ufe0f' },
      { label: 'Live-action, no preference', value: 'live_action', icon: '\ud83c\udfa5' },
    ],
  },
  {
    id: 'company',
    question: "Who's watching?",
    subtitle: 'Sets the tone for the picks',
    options: [
      { label: 'Solo', value: 'solo', icon: '🙋' },
      { label: 'Date night', value: 'date', icon: '💑' },
      { label: 'Friends', value: 'friends', icon: '🎉' },
      { label: 'Family + kids', value: 'family', icon: '👨‍👩‍👧' },
    ],
  },
];
