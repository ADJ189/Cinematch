# Changelog

All notable changes to this project are documented here.

## [1.5.0] — Title search + real similarity data, streaming availability, more avatars

### Added
- **Search screen (`src/screens/search.ts`).** Search for a specific movie or show and see what's actually similar to it. Deliberately *not* run through the quiz-calibrated engine — people's taste isn't the same every session, so a single title's similarity is better answered by TMDB's own data than by re-scoring it against stated quiz preferences from a different visit. `getSimilarTitles()` in `tmdb.ts` merges `/recommendations` (collaborative filtering — what people who engaged with this title also engaged with) with `/similar` (genre/keyword/cast overlap) as a fallback for titles where recommendations data is thin.
- **Streaming availability**, originally slated for a later v1.4.5 — feasible to include now, so it shipped here instead. `getWatchProviders()` pulls TMDB's JustWatch-sourced region data (guessed from the browser's locale, falling back to US) and renders stream/rent/buy provider logos with a link to full availability. Shown on the search screen's hero and, for consistency, on the quiz-results detail modal too — loaded asynchronously so it never blocks the rest of the detail view from rendering. Always paired with a "full availability" link, never presented as a standalone play action, since JustWatch/TMDB data isn't guaranteed complete or current.
- **On-device AI now also summarizes search-similar picks.** The same local model used to rewrite quiz-result reasons into one sentence (`explainPick()`) is reused here with a similarity-specific prompt instead of a quiz summary — "use AI to summarize/precise the recommends" is the same underlying feature applied to a second context, not a second AI integration.
- **More avatar options.** The color palette grew from 7 to 11, and a small picker for a curated, film-themed emoji set (🎬🍿🎭👾🐉🚀🔮🕵️👻🦇🧙📼) was added to the profile popover — pick a color, an icon, or both. The plain initial-letter avatar is still there as the default/fallback, never required to change.

### Changed — performance
- **Screens are now lazily loaded.** Landing is the only screen bundled into the initial script; quiz/rating/results/search each became a separate chunk, fetched on first navigation to that screen. Initial JS dropped from ~17.4 kB gzip to ~9.5 kB gzip — meaningful for the (common) case of someone previewing the landing page and leaving, who now never downloads the search screen's TMDB-similarity/watch-provider code at all.
- **`tmdbFetch()` now caches by request URL and de-dupes in-flight requests.** Reopening a detail modal, retyping a search you already ran, or two UI elements requesting the same title's watch providers in the same render all used to mean duplicate network calls; they now resolve from a session-lifetime cache (bounded to 300 entries) or collapse into the one request already in flight.
- **Extracted `src/lib/providers-ui.ts`.** The watch-providers row was on track to become two near-identical implementations (search screen + results modal); it's a single shared module instead.

### Scope note
File count is up (`search.ts`, `providers-ui.ts`, `search.css` are new — see the README's file list for the full upload manifest). The per-option emoji on the quiz screen are still untouched, same reasoning as 1.4.1.

## [1.4.1] — Custom icon set, warmer light theme

A continuation of 1.4.0's "closer to seriesgraph.com" pass — this part is
the visual craft layer on top of last version's functional one (local
profile, watchlist, hover preview).

### Added
- **`src/lib/icons.ts`** — a small custom inline-SVG icon set replacing the emoji chrome that was scattered through buttons and badges (🔀🌙☀️🍅Ⓜ️⭐✕ℹ️). Emoji render inconsistently across OS/browser (different weight, color, sometimes a completely different silhouette); a custom set inherits `currentColor` so it themes for free and reads as considered rather than default. Wired into the theme toggle, shuffle/back/close buttons, rating badges, the results note banner, and the empty-state actions.
- Rating rows (hover preview + detail modal) now use a middle-dot separator between icon+label pairs (`⭐ 8.4 · 🍅 91% · IMDb 8.2` → the same idea, rendered with the new icons) — a small nod to the "eps · rating · votes" chip style used on seriesgraph.com's show pages.

### Changed
- **Light theme is warmer.** The neutral canvas (backgrounds, surfaces, borders) shifted from a cool violet-tinted white to a warm cream/paper base — closer to the editorial, poster-forward feel of sites like seriesgraph.com, whose own `theme-color` is a warm `#f4eff0`. The violet/cyan/amber accent colors are unchanged; only the neutral canvas underneath them moved warm, since that's what was reading as "generic dark-app light-mode" rather than a considered light theme.
- `theme-color` meta (static in `index.html` and the JS-driven update in `src/lib/theme.ts`) both updated to match.

### Scope note
The per-option emoji on the quiz screen (mood/era/company/etc.) were left as-is — replacing dozens of option icons is a much larger, separate pass, and unlike the button/badge chrome, playful per-choice emoji in a quiz UI is a reasonably normal pattern rather than a polish problem.

## [1.4.0] — Local profile, watchlist, richer result previews

Moves the app from "everything resets when you close the tab" toward the
seriesgraph.com-style feel of a site that remembers you — without adding a
backend, a password, or anything that leaves the browser.

### Added
- **Local profile (`src/lib/profile.ts`).** A localStorage-backed identity — display name, avatar, and a full rating history — created automatically on first visit, no signup. Framed honestly in the UI as exactly what it is: on-this-device only, nothing synced, nothing sent anywhere. Falls back to session-only behavior (rather than crashing) if the browser is blocking storage (private mode etc.), and says so.
- **Ratings persist across sessions**, both from the calibration screen and the results screen. Closing the tab no longer resets your taste profile.
- **The engine now uses that whole history, every run.** Every previously-rated title (not just this session's) is fed into `engine.processResultRating()` before scoring, and excluded from ever being re-recommended — so a returning user's very first batch is already informed instead of a cold start every time. This is the concrete version of "let the AI use more data."
- **Watchlist.** A bookmark toggle on every result card and in the detail modal, a persistent watchlist panel in the header's profile popover (reachable from every screen), stored in the same local profile.
- **Hover/click info preview.** Hovering a result poster now reveals a quick-glance panel — synopsis snippet + TMDB/RT/IMDb ratings — using data already on the card (no extra fetch). Clicking still opens the full detail modal (cast-level synopsis, full ratings breakdown, trailer link, watchlist toggle, rate). Touch devices skip straight to the tap-through modal since there's no hover state to reveal the panel in.
- A landing-screen "Welcome back" banner for returning profiles, showing how many titles have been rated on this device and swapping the CTA to "Get fresh picks."

### Changed
- Landing page eyebrow copy updated from "no account" to "no server account / nothing leaves your device untracked" — still accurate (there's genuinely no backend or sync), now precise about what the local profile is.

### Scope note
This is the functional core of the "make it feel like seriesgraph.com" ask — persistence, a watchlist, richer previews. A full visual pass (new type scale, poster-wall layouts, a broader custom icon set matching that specific editorial look) is a separate, larger design pass and wasn't attempted wholesale here to avoid a half-finished reskin sitting on top of a half-tested one.

## [1.3.0] — Worker migration, three real bug fixes, resilience pass

### Fixed
- **On-device AI failed with "unavailable/error" on most devices.** Root cause: `ai-worker.ts` manually pointed `wasmPaths` at `@huggingface/transformers`'s own CDN dist folder to "pin" the WASM source — but that folder only ships a JS glue file, not the actual `.wasm` binaries (those live in the separate `onnxruntime-web` package, at a specific version transformers.js resolves internally). Every WASM-tier load 404'd on the binary fetch, which is most devices — WebGPU is the minority path. Fixed by not overriding `wasmPaths` at all; the library's own default is version-correct by construction. Also added a real `navigator.gpu.requestAdapter()` check instead of trusting `'gpu' in navigator` (true even with no usable adapter behind it), and gated multi-threaded WASM behind `self.crossOriginIsolated` (it needs `SharedArrayBuffer`, which throws without COOP/COEP headers — see "Changed" below for where those now come from).
- **Selecting an era (e.g. "Classic — pre-2000") could still surface newer titles.** `engine.ts` only applied era as a soft +12/-4 score nudge; TMDB's server-side date filter isn't airtight (re-release dates, missing region, occasional bad data), and a strong genre/vibe match could outscore the penalty regardless. Era is now hard-filtered in `engine.getResults()` before scoring — the era you pick is the era you get.
- **Recommendations "ran out" after rating just a few results.** Every rating triggered a debounced `rescore()` that excluded everything already in `shownIds` — which, for a narrower filter combination, could already cover the entire fetched pool after only 2-3 ratings. The next rescore silently returned an empty array and got rendered as-is: no fallback, no message, just a blank grid. Replaced with `ensureBatch()`, which escalates through fallbacks — retry ignoring the shown-set, pull a later TMDB page window, drop Precise mode's match floor, and only as a last resort show the pool's best titles again — surfacing an honest note (`.results-note`) whenever it had to compromise, and a real inline empty-state card (with "Different picks" / "Adjust answers" actions) in the true last-resort case instead of ever leaving the grid blank.

### Changed — architecture
- **Migrated from Cloudflare Pages to a genuine Cloudflare Worker.** `functions/api/recommend.ts` (a Pages Functions convention) is now `worker/index.ts`, a real `fetch` handler: it serves `dist/` via the `ASSETS` binding for everything except `/api/recommend`, and stamps `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp` onto every response. Those two headers are what actually make `self.crossOriginIsolated` true, which is what unlocks the multi-threaded WASM fast path referenced above. `wrangler.jsonc` now declares `main` (previously assets-only) and keeps the same Worker name so redeploying doesn't orphan the existing project's Cloudflare variables. `wrangler` was also missing from `devDependencies` despite `wrangler.jsonc` existing — added, along with `worker:dev` and `deploy` scripts.
- `tsconfig.json` now typechecks `worker/` — the old `functions/` directory was never actually covered by `tsc --noEmit`, so a break there could ship silently.
- `package.json` version corrected to track this changelog (it had drifted to `3.2.0` against a `1.2.0` changelog top).

### Added
- Small, targeted motion in the two places users actually watch: the match% badge on each result card now pops in on render, and a star pops on fill — both via the existing `--dur-fast`/`--ease-spring` tokens, so `prefers-reduced-motion` still disables them for free.

## [1.2.0] — Adaptive quiz, genre-weighted calibration, resource-aware AI, perf pass

### Fixed
- **On-device AI still failed on some devices/networks.** A single hardcoded CDN and a single model repo meant any one of: that CDN being blocked by a network/proxy, a transient CDN outage, or that specific Hugging Face repo being briefly rate-limited, took the whole feature down. `ai-worker.ts` now tries a short list of CDNs for the library itself and a short list of model repos per resource tier, in order, until one combination actually finishes loading. WASM execution is now explicitly multi-threaded (sized to leave one core free for the UI) instead of single-threaded.
- **Posters appearing not to load.** Cards used to sit as blank/empty boxes with no feedback while a poster image was still in flight. `dom.ts`'s new `buildPosterImage()` keeps a visible skeleton shimmer until the image actually finishes decoding, then crossfades it in; a failed image falls back to a letter placeholder instead of staying blank. Off-screen posters use native lazy-loading so they don't compete with the first results batch for bandwidth.
- Recommendations no longer stall on a cold connection: TMDB requests now carry a 9s timeout + one retry (`tmdbFetch`), instead of an in-flight request hanging indefinitely on a flaky mobile network.

### Added
- **Resource-aware model selection.** `ai-worker.ts` picks a tier (model + quantization + device) from `navigator.deviceMemory`, `hardwareConcurrency`, WebGPU availability, and mobile detection — a 16-core desktop with a GPU and a budget phone no longer get the identical request.
- **Genre-weighted taste calibration** (`src/lib/rating-pool.ts`). Picking a mood in the quiz now pulls ~75% of the rating step's titles live from TMDB in that genre (diversified by vibe, capped by vote count), instead of always showing the same fixed 15 regardless of answer.
- **Adaptive quiz.** The vibe question filters out options that would directly contradict the mood just picked (e.g. "horror" removes "light & fun" / "feel-good"); previously-selected options are highlighted when navigating back.
- **Anime / cartoon / sitcom as their own dimension** — a new `contentType` quiz question, separate from mood/tone, mapped to TMDB's Animation genre (split into anime vs. cartoon by original language) and TV Comedy for sitcom (which also forces series-only, since "sitcom movie" isn't a meaningful TMDB query).
- **Precise / Grouped results toggle** — Grouped is the original wide, forgiving pool; Precise holds results to a 68%+ match floor and returns fewer, tighter picks.
- **Debounced in-place rating.** Rating a result card updates its stars immediately but waits ~1.6s (resetting on each new tap) before re-curating the grid, with a "Curating your picks…" indicator — avoids a full re-render on every single click during a quick rating streak.
- Boot-time loading spinner (inlined critical CSS in `index.html`, dismissed by `main.ts` once the first screen mounts) for the gap between first paint and the JS bundle finishing parse/exec on slower connections/devices.
- `preconnect` hints for the TMDB API and image CDN.

### Changed
- The landing page's fluid background sim now runs at a lower grid resolution on mobile or ≤4-core devices — it's CPU-bound Canvas2D, not GPU work, so full resolution was a real jank/battery cost on phones.
- Results toolbar restructured: the mode toggle is now a visually distinct segmented control instead of competing with action buttons in one row; buttons stack full-width on screens under 640px instead of squeezing.
- `engine.processRatings` signal source and `rating.ts`'s seed list are now read from the store (`ratingSeeds`/`ratingSignals`), populated by whichever pool (static or genre-weighted) actually got shown and rated.

## [1.1.0] — Reliability, refinement loop, and a design pass

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

## [0.9.0] — Full rebuild

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
