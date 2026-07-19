import type { QuizQuestion } from '../lib/types';

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
