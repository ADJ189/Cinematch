# Changelog

All notable changes to this project are documented here.

## [3.0.0] — Full rebuild

### Fixed
- **Recommendations no longer repeat regardless of quiz answers.** Root cause was two-fold: the AI recommendation call silently failed (Workers AI binding not active) and fell back to a client-side scorer running against a **hardcoded 30-title catalog**, whose flat quality bonus (`(rating - 7) * 5`, up to ±12.5) outweighed the actual quiz signal (max ±30 across 6 questions). Fixed by rewriting the scoring model and replacing the fixed catalog with a live TMDB pool.
- `package.json` had duplicate `svelte`/`typescript`/`vite` keys from a bad merge — removed entirely along with Svelte.

### Changed — architecture
- **Framework removed.** Svelte 5 + SvelteKit → vanilla TypeScript + Vite. Initial JS payload dropped to ~5 kB gzipped.
- **Catalog is now live, not static.** `src/lib/tmdb.ts` queries TMDB's `/discover/movie` and `/discover/tv` directly, filtered by genre/era/language — hundreds of candidates per query instead of 30 fixed ones.
- **Scoring rebalanced.** Quality bonus capped to ±3 (tiebreaker, not driver); rating-derived taste signal weighted above one-off quiz picks; match% now normalized against the actual score spread of each query instead of a fixed clamp, so results meaningfully separate instead of clustering near 99%.

### Added
- OMDb connector for Rotten Tomatoes / Metacritic / IMDb as a secondary signal (`src/lib/omdb.ts`)
- Letterboxd `ratings.csv` import for taste calibration (`src/lib/letterboxd.ts`)
- Optional on-device AI reason-writer, CDN-loaded and opt-in only (`src/lib/llm.ts`)
- New landing screen, quiz flow with progress bar and back navigation, taste-calibration screen with live poster resolution
- Custom logo (`public/logo.svg`, `public/favicon.svg`)
- This changelog

### Removed
- All `.svelte` components and `svelte.config.js`
- The hardcoded 30-item catalog (`src/lib/data.ts`)
- `src/stores/appState.svelte.ts` (replaced by `src/lib/store.ts`, framework-free)

### Security
- `npm audit`: 0 vulnerabilities. The on-device AI dependency (`@huggingface/transformers`) was deliberately kept out of `package.json` — its Node backend pulls in `onnxruntime-node` and `sharp` as hard dependencies (native postinstall, irrelevant for a browser-only feature) and previously carried transitive `protobufjs` vulnerabilities via the older `@xenova/transformers`. It's loaded from CDN at runtime only if a user opts in.
