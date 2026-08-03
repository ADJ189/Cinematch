<div align="center">

<img src="public/logo.svg" width="88" alt="CineMatch logo" />

# CineMatch

**Find what to watch, in 60 seconds.**
Six quick questions, a few titles you already know, and a live pull from thousands of real TMDB titles — matched to your taste, not re-sorted from a fixed list.

[![Build](https://img.shields.io/badge/build-Vite%208-7c5cf0?style=flat-square)](https://vitejs.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?style=flat-square)](https://www.typescriptlang.org)
[![License: Apache 2.0](https://img.shields.io/badge/license-Apache%202.0-blue?style=flat-square)](./LICENSE)
[![No framework](https://img.shields.io/badge/framework-none-22d3ee?style=flat-square)](#stack)
[![Deploy](https://img.shields.io/badge/deploy-Cloudflare%20Workers-f38020?style=flat-square)](#deploying-cloudflare-workers)

[Features](#features) · [Setup](#setup) · [Architecture](#architecture) · [Deploying](#deploying-cloudflare-workers)

</div>

---

## Features

- **Live catalog, not a fixed list.** Every query hits TMDB's `/discover` endpoints directly — hundreds of candidates per query, filtered by genre, era, format, and language, so results actually change with your answers.
- **Search a title, see what's actually similar.** A separate flow from the quiz: search any movie or show, and get similar titles pulled straight from TMDB's own recommendation data (collaborative filtering, with genre/cast overlap as a fallback) rather than re-scored against your quiz answers — taste isn't the same every session, and a single title's similarity is a different question than "what fits this user's stated preferences."
- **Streaming availability.** See where a title is available to stream, rent, or buy (region-aware, JustWatch data via TMDB) on both the search screen and the results detail modal, always with a link to the full listing.
- **A local profile that remembers you — no account needed.** A lightweight, on-this-device identity is created automatically on first visit: your rating history and watchlist persist across sessions (closing the tab doesn't reset anything), and every past rating feeds back into the engine on your next visit, so a returning session starts already informed instead of cold. Nothing is a server account — there's no signup, no sync, nothing sent anywhere; reachable any time from the profile icon in the header, including a one-click reset. Pick from 11 colors and a curated set of film-themed icons for your avatar, or just keep the default initial letter.
- **Watchlist.** Bookmark any result from its card or the detail modal; see and manage the list from the header on any screen.
- **Hover for the quick take, click for the full picture.** Hovering a result reveals a quick synopsis + ratings preview right on the card; clicking opens the full detail modal — cast-level synopsis, TMDB/Rotten Tomatoes/Metacritic/IMDb scores, streaming availability, a trailer link, and the watchlist toggle.
- **Adaptive quiz.** Seven quick questions, including a dedicated anime / Western cartoon / sitcom style pick. Later questions narrow their own options based on what you've already answered — picking "horror" won't then offer "light & fun" as a tone.
- **Genre-weighted taste calibration.** Picking a mood pulls ~75% of the titles you rate live from TMDB in that genre, with the rest kept as broadly-known anchors — rating "horror" actually calibrates against horror, not a fixed generic list.
- **An era pick that's actually enforced.** Era (classic/mid/recent) is a hard filter on the candidate pool, not just a scoring nudge — picking "pre-2000" won't let a strong genre match sneak a 2020s title past it.
- **Keep refining after you get results.** Rate any recommendation right on its card and the whole grid re-curates using every signal collected so far — this session's ratings and every rating your local profile remembers (rating updates instantly; re-curation debounces ~1.6s so a quick streak of taps doesn't re-render on every click). Want a different batch entirely? One click pulls a fresh, unseen set from TMDB. If a narrow filter combination genuinely runs low, the app escalates through fallbacks (a later TMDB page, a loosened Precise floor, then a labeled repeat) instead of ever leaving you with a blank screen.
- **Precise / Grouped results toggle.** Grouped is a wide, forgiving pool (default). Precise holds results to a 68%+ match floor and returns fewer, tighter picks.
- **Optional on-device AI.** Turns each result's rule-based reasons — quiz-flow or search-similarity — into one natural sentence, running entirely in a Web Worker. Picks a model/quantization tier from your device's memory, core count, and WebGPU support (with a real adapter check, not just API-surface detection), and falls through several CDN and model-repo options until one loads — no server call, no API key, nothing leaves your device. Opt-in, never a dependency.
- **Dark mode and light mode**, persisted and defaulting to your system preference.
- **No tracking, no server account.** Nothing is sent anywhere except the TMDB/OMDb API calls needed to fetch and score titles. The local profile above lives entirely in your browser's localStorage.

## Screenshots

| Landing | Results |
|---|---|
| _Add a screenshot of the landing screen here_ | _Add a screenshot of the results grid here_ |

## Stack

Vanilla TypeScript + Vite. No framework. The UI is four screens and a ~70-line pub-sub store (`src/lib/store.ts`) — not enough surface area to justify a compiler-driven framework, and it keeps the bundle small (first-paint JS gzips to roughly 12 kB; the on-device AI worker and the fluid canvas background are separate, lazily-loaded chunks that most page loads never touch).

| | |
|---|---|
| **Language** | TypeScript, `strict: true`, zero `any` outside two isolated worker-boundary casts |
| **Build** | Vite 8 |
| **Data** | [TMDB](https://www.themoviedb.org/documentation/api) (required), [OMDb](https://www.omdbapi.com/) (optional) |
| **On-device AI** | [`@huggingface/transformers`](https://huggingface.co/docs/transformers.js) v4, loaded from CDN, Web Worker, WebGPU with a WASM fallback |
| **Deploy target** | Cloudflare Workers (static assets + a small API Worker) |

## Setup

This deployment already has `VITE_TMDB_TOKEN` set as a Cloudflare **project variable**, so production builds don't need anything from you — this section is for running the app locally.

```bash
npm install
cp .env.example .env
```

Fill in `.env`:

| Variable | Required | Where to get it |
|---|---|---|
| `VITE_TMDB_TOKEN` | Yes for local dev — the app runs in a "TMDB not configured" demo state without it | [themoviedb.org/settings/api](https://www.themoviedb.org/settings/api) → API Read Access Token (v4) |
| `VITE_OMDB_KEY` | No — adds Rotten Tomatoes / Metacritic / IMDb as a secondary signal | [omdbapi.com/apikey.aspx](https://www.omdbapi.com/apikey.aspx) (free tier) |

```bash
npm run dev        # local Vite dev server
npm run typecheck  # strict TypeScript, zero errors (covers src/ and worker/)
npm run build      # production build to dist/
npm run worker:dev # run the actual Cloudflare Worker locally via wrangler, serving dist/
```

`VITE_`-prefixed vars are build-time only — they get baked into the client bundle by Vite, not read at request time by the Worker. That's why they're set as Cloudflare **project variables** (used at build time), not Worker secrets.

## Architecture

```
src/
  lib/
    tmdb.ts        live catalog — /discover/movie + /discover/tv, genre-mapped, era-classified,
                    paginated on demand so "different picks" pulls a genuinely new batch; also
                    search/multi, /recommendations + /similar, and /watch/providers. Responses are
                    cached by request URL for the session, with in-flight de-duping
    engine.ts       scoring model — quiz + calibration ratings + in-session result ratings → matchPct
                    + reasons; era is a hard filter here, not just a score nudge
    providers-ui.ts shared watch-providers row builder — used by both the search screen and the
                    results detail modal so streaming availability looks identical everywhere
    omdb.ts         optional secondary rating signal (Rotten Tomatoes / Metacritic / IMDb)
    letterboxd.ts   parses a Letterboxd ratings.csv export for taste calibration
    rating-pool.ts  builds the calibration list — ~75% genre-weighted to the quiz's mood when TMDB is available
    llm.ts          main-thread wrapper for the on-device AI: timeouts, caching, status
    ai-worker.ts    the on-device model itself — resource-tiered, multi-CDN/model fallback, WebGPU → WASM
    profile.ts      the local profile — localStorage-backed identity, avatar, rating history, and
                     watchlist; no backend, no password, nothing synced off this device
    icons.ts        the inline-SVG icon set (replaces emoji chrome), themes via currentColor
    theme.ts        light/dark mode, persisted, defaults to system preference
    header.ts       persistent top bar — logo, search entry point, profile popover, theme toggle, GitHub link
    fluid.ts        the Navier-Stokes canvas background on the landing screen
    store.ts        ~90-line pub-sub store — the entire "framework"
    dom.ts          tiny element-builder helper
  screens/          landing, quiz, rating, results, search — one module each, lazily loaded except landing
  data/             quiz questions, taste-calibration seed titles
worker/
  index.ts          the Cloudflare Worker entry point — serves dist/ via the ASSETS binding, handles
                     POST /api/recommend (OPTIONAL Workers AI re-ranking pass), and sets the
                     COOP/COEP headers the on-device AI's multi-threaded WASM path needs
```

**The client-side engine is fully self-sufficient.** `worker/index.ts`'s `/api/recommend` route is an enhancement layer, not a dependency — the app works completely without Workers AI enabled, and nothing in `src/` currently calls that route. If you do want it, you must turn the AI binding on in the Cloudflare dashboard (Settings → Bindings), not just declare it in `wrangler.jsonc`.

### Search + similar titles vs. the quiz engine

`search.ts` is deliberately not just "results.ts with a search box." The quiz flow scores candidates against *this user's* stated preferences from *this* session — the right model for "recommend me something," wrong for "what's actually similar to this one title," since a title's similarity doesn't depend on who's asking, and people's own taste isn't static from session to session either. So similarity comes from TMDB's own data instead: `getSimilarTitles()` merges `/recommendations` (collaborative filtering) with `/similar` (genre/cast/keyword overlap, used to fill gaps when recommendations data is thin) and doesn't run the result through `engine.ts` at all. The on-device AI is still available here — same `explainPick()` used by the quiz flow, just given a similarity-framed prompt instead of a quiz summary.

### Performance

- **Lazy-loaded screens.** Landing is the only screen in the initial bundle; quiz/rating/results/search are separate chunks fetched on first navigation — someone who previews the landing page and leaves never downloads the search screen's TMDB-similarity/watch-provider code.
- **Request caching + de-dupe.** `tmdbFetch()` caches by request URL for the session (capped at 300 entries) and collapses concurrent identical requests into one — reopening a detail modal or retyping a search you already ran resolves from cache instead of hitting the network again.

### How recommendations stay fresh (and never dead-end)

1. The quiz and calibration ratings seed an initial TMDB query (up to 3 pages × 2 media types), hard-filtered by era if one was picked.
2. `engine.ts` scores every candidate and returns the top batch, excluding anything already shown.
3. Rating a result card feeds that title's own genre/vibe tags straight back into the engine — no lookup table needed, since every live TMDB result already carries that data — and the grid re-scores after a short debounce.
4. If that re-score comes back empty — which used to happen after just a few ratings on a narrow filter combination — `ensureBatch()` in `results.ts` escalates: retry ignoring the "already shown" set, pull a later TMDB page window, drop Precise mode's match floor, and only as a last resort show the pool's best titles again. Whenever it had to compromise to avoid a dead end, it says so in a small note instead of silently repeating titles.

### On-device AI, and why it used to fail

The actual cause: `ai-worker.ts` used to manually pin `wasmPaths` (where the WASM binary that runs the model gets fetched from) at `@huggingface/transformers`'s own CDN folder — but that folder only contains a JS glue file, not the `.wasm` binary itself. The real binary ships in the separate `onnxruntime-web` package, at whatever version transformers.js resolves internally. Every WASM-tier load therefore 404'd on the binary fetch, which is most devices — WebGPU is the minority path. Fixed by not overriding `wasmPaths` at all; the library's own default is correct by construction.

Two related hardening fixes went in alongside it: a real `navigator.gpu.requestAdapter()` check before attempting the WebGPU tier (the API surface can exist with no usable adapter behind it), and multi-threaded WASM is now only requested when the page is actually cross-origin isolated (`self.crossOriginIsolated`) — which needs `SharedArrayBuffer`, which the browser only grants with `Cross-Origin-Opener-Policy`/`Cross-Origin-Embedder-Policy` response headers. `worker/index.ts` now sets both on every response, so the fast multi-threaded path is genuinely available; without them the AI worker still runs, just single-threaded.

## Connectors

- **TMDB** — required, the live catalog, search, similarity, and streaming-availability source
- **OMDb** — optional, adds Rotten Tomatoes/Metacritic/IMDb as a scoring signal
- **Letterboxd** — optional, import a `ratings.csv` export to skip manual re-rating
- **Local profile** — always on, no opt-in needed: a localStorage-backed identity + rating history + watchlist, scoped to this browser only. No server, no account, nothing to connect.
- **On-device AI** — optional, opt-in per session from the results or search screen. Loads a small quantized model from CDN at runtime (never part of `npm install` — see the comment at the top of `src/lib/ai-worker.ts` for why)

## Deploying (Cloudflare Workers)

```bash
npm run deploy   # builds, then runs `wrangler deploy`
```

This is a genuine Cloudflare Worker (`wrangler.jsonc` declares `main: worker/index.ts`), not a Pages project — it serves the built `dist/` folder via Workers Static Assets and handles `/api/recommend` itself. Set `VITE_TMDB_TOKEN` (and optionally `VITE_OMDB_KEY`) as **project variables** in the Cloudflare dashboard so they're present when `npm run build` runs; `.env` is gitignored and never committed.

If you're redeploying over an existing deployment, don't rename the `name` field in `wrangler.jsonc` — `wrangler deploy` matches on that name, and renaming it creates a brand-new, unconfigured Worker instead of updating the one that already has your variables set.

## Contributing

Issues and PRs are welcome. Before opening a PR:

```bash
npm run typecheck   # must be clean — strict mode, no exceptions, covers src/ and worker/
npm run build       # must succeed
```

Keep the "no framework" constraint in mind — new UI goes through `src/lib/dom.ts`'s `el()` helper, not a new dependency.

## Security

`npm audit` reports 0 vulnerabilities as of this rebuild. See [SECURITY.md](./SECURITY.md) for the reporting policy. Dependabot is configured for weekly npm checks.

## License

Apache 2.0 — see [LICENSE](./LICENSE).
