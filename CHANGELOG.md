# Changelog

All notable changes to this project are documented here.

## [3.1.0] — Reliability, refinement loop, and a design pass

### Fixed
- **On-device AI failed intermittently.** It loaded on the main thread with no explicit quantization or device selection, so it silently pulled the largest available build (often full `fp32`) regardless of connection speed or device memory — the most likely reason loads stalled out or ran out of memory on ordinary laptops and most phones. A WebGPU-only path also had no fallback, so it failed outright on browsers/systems without WebGPU. Rewritten as `src/lib/ai-worker.ts` + `src/lib/llm.ts`: runs off the main thread in a Web Worker, requests the smallest quantization each backend supports (`q4` WebGPU → `q8` WASM → `q4` WASM), points the WASM loader at a reliable CDN path, uses proper chat-formatted prompts instead of string-splitting a raw completion, and enforces load/generate timeouts so a stalled connection degrades to the rule-based reasons instead of hanging forever.

### Added
- **Keep rating after you get results.** Every result card has an inline star row; rating a title feeds its own genre/vibe signal straight back into the engine (`RecommendationEngine.processResultRating`) and the whole grid re-curates immediately — no restart needed.
- **"Show me different picks."** Pulls a genuinely new batch: first from the unseen remainder of the already-fetched pool, then by paging further into TMDB, falling back to allowing repeats only once a filter combination is truly exhausted.
- **Movie detail modal.** Click any poster or title to check a synopsis, genre/vibe tags, TMDB/RT/Metacritic/IMDb scores, and a link to the title's TMDB page before deciding to watch — with the same rating control built in.
- **Dark mode / light mode**, persisted in `localStorage`, defaulting to system preference, applied pre-paint to avoid a flash of the wrong theme (`src/lib/theme.ts`).
- **Persistent header** with the CineMatch logo, a GitHub link, and the theme toggle (`src/lib/header.ts`), present across all four screens.
- `tmdb.ts`'s `discoverCandidates` now accepts a page offset so callers can pull a later results window instead of only ever seeing pages 1-3.

### Changed
- Display font swapped from Bricolage Grotesque to **Sora** — a cleaner geometric grotesque that reads as product-grade rather than editorial.
- More motion throughout: staggered card entrance on the results grid, a subtle animated gradient on primary buttons, hover glow on quiz options, smoother cross-theme transitions.
- `engine.processRatings` now accumulates across repeated calls instead of overwriting, since the results screen re-runs it on every re-score.
- README and SECURITY.md rewritten.

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
