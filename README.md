<div align="center">

<img src="public/logo.svg" width="88" alt="CineMatch logo" />

# CineMatch

**Find what to watch, in 60 seconds.**
Six quick questions, a few titles you already know, and a live pull from thousands of real TMDB titles — matched to your taste, not re-sorted from a fixed list.

[![Build](https://img.shields.io/badge/build-Vite%208-7c5cf0?style=flat-square)](https://vitejs.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?style=flat-square)](https://www.typescriptlang.org)
[![License: Apache 2.0](https://img.shields.io/badge/license-Apache%202.0-blue?style=flat-square)](./LICENSE)
[![No framework](https://img.shields.io/badge/framework-none-22d3ee?style=flat-square)](#stack)
[![Bundle size](https://img.shields.io/badge/first%20paint%20JS-~9%20kB%20gzip-4ade80?style=flat-square)](#stack)

[Features](#features) · [Setup](#setup) · [Architecture](#architecture) · [Deploying](#deploying-cloudflare-pages)

</div>

---

## Features

- **Live catalog, not a fixed list.** Every query hits TMDB's `/discover` endpoints directly — hundreds of candidates per query, filtered by genre, era, format, and language, so results actually change with your answers.
- **Taste calibration.** Rate a handful of titles you already know (or import a Letterboxd `ratings.csv` export) before the engine runs its first query.
- **Keep refining after you get results.** Rate any recommendation right on its card and the whole grid re-curates immediately using every signal collected so far. Want a different batch entirely? One click pulls a fresh, unseen set from TMDB instead of re-sorting the same pool.
- **Check before you commit.** Click any poster for a detail view — synopsis, genre/vibe tags, TMDB/Rotten Tomatoes/Metacritic/IMDb scores, and a direct link to the title's TMDB page for trailers and reviews.
- **Optional on-device AI.** Turns each result's rule-based reasons into one natural sentence, running entirely in a Web Worker in your browser — no server call, no API key, nothing leaves your device. Opt-in, never a dependency.
- **Dark mode and light mode**, persisted and defaulting to your system preference.
- **No account, no tracking.** Nothing is sent anywhere except the TMDB/OMDb API calls needed to fetch and score titles.

## Screenshots

| Landing | Results |
|---|---|
| _Add a screenshot of the landing screen here_ | _Add a screenshot of the results grid here_ |

## Stack

Vanilla TypeScript + Vite. No framework. The UI is four screens and a ~70-line pub-sub store (`src/lib/store.ts`) — not enough surface area to justify a compiler-driven framework, and it keeps the bundle small (**~9 kB gzipped JS** on first paint; the on-device AI worker and the fluid canvas background are separate, lazily-loaded chunks that most page loads never touch).

| | |
|---|---|
| **Language** | TypeScript, `strict: true`, zero `any` outside two isolated worker-boundary casts |
| **Build** | Vite 8 |
| **Data** | [TMDB](https://www.themoviedb.org/documentation/api) (required), [OMDb](https://www.omdbapi.com/) (optional) |
| **On-device AI** | [`@huggingface/transformers`](https://huggingface.co/docs/transformers.js) v4, loaded from CDN, Web Worker, WebGPU with a WASM fallback |
| **Deploy target** | Cloudflare Pages (static, with an optional Pages Function) |

## Setup

```bash
npm install
cp .env.example .env
```

Fill in `.env`:

| Variable | Required | Where to get it |
|---|---|---|
| `VITE_TMDB_TOKEN` | Yes — the app runs in a "TMDB not configured" state without it | [themoviedb.org/settings/api](https://www.themoviedb.org/settings/api) → API Read Access Token (v4) |
| `VITE_OMDB_KEY` | No — adds Rotten Tomatoes / Metacritic / IMDb as a secondary signal | [omdbapi.com/apikey.aspx](https://www.omdbapi.com/apikey.aspx) (free tier) |

```bash
npm run dev        # local dev server
npm run typecheck  # strict TypeScript, zero errors
npm run build      # production build to dist/
```

## Architecture

```
src/
  lib/
    tmdb.ts        live catalog — /discover/movie + /discover/tv, genre-mapped, era-classified,
                    paginated on demand so "different picks" pulls a genuinely new batch
    engine.ts       scoring model — quiz + calibration ratings + in-session result ratings → matchPct + reasons
    omdb.ts         optional secondary rating signal (Rotten Tomatoes / Metacritic / IMDb)
    letterboxd.ts   parses a Letterboxd ratings.csv export for taste calibration
    llm.ts          main-thread wrapper for the on-device AI: timeouts, caching, status
    ai-worker.ts    the on-device model itself — runs off the main thread, WebGPU → WASM fallback
    theme.ts        light/dark mode, persisted, defaults to system preference
    header.ts       persistent top bar — logo, GitHub link, theme toggle
    fluid.ts        the Navier-Stokes canvas background on the landing screen
    store.ts        ~70-line pub-sub store — the entire "framework"
    dom.ts          tiny element-builder helper
  screens/          landing, quiz, rating, results — one module each
  data/             quiz questions, taste-calibration seed titles
functions/api/
  recommend.ts      OPTIONAL Cloudflare Workers AI re-ranking pass
```

**The client-side engine is fully self-sufficient.** `functions/api/recommend.ts` is an enhancement layer, not a dependency — the app works completely without Workers AI enabled. If you do want it, you must turn the AI binding on in the Cloudflare Pages dashboard (Settings → Functions), not just declare it in `wrangler.jsonc`.

### How recommendations stay fresh

1. The quiz and calibration ratings seed an initial TMDB query (up to 3 pages × 2 media types).
2. `engine.ts` scores every candidate and returns the top batch, excluding anything already shown.
3. Rating a result card feeds that title's own genre/vibe tags straight back into the engine — no lookup table needed, since every live TMDB result already carries that data — and the grid re-scores immediately.
4. "Show me different picks" first tries the unseen remainder of the pool already fetched; if that's running low, it pages further into TMDB before falling back to allowing repeats, so the combination of filters you picked never dead-ends into a blank screen.

### On-device AI, and why it used to fail

The previous version loaded the model on the main thread with no explicit quantization or device selection. In practice that meant: the largest available build (often full `fp32`) got pulled regardless of connection or device, so loads regularly stalled out or exhausted memory on ordinary laptops and most phones; a WebGPU-only path failed outright with no fallback on browsers or systems without it; and a slow WASM decode froze the results screen while it ran.

The current version (`ai-worker.ts` + `llm.ts`) fixes all three: it requests the smallest quantization each backend supports (`q4` on WebGPU, `q8` on WASM, with a `q4` WASM retry), runs entirely in a Web Worker so the UI thread never blocks, and enforces load/generate timeouts so a stalled connection degrades to the rule-based reasons instead of hanging the button forever.

## Connectors

- **TMDB** — required, the live catalog source
- **OMDb** — optional, adds Rotten Tomatoes/Metacritic/IMDb as a scoring signal
- **Letterboxd** — optional, import a `ratings.csv` export to skip manual re-rating
- **On-device AI** — optional, opt-in per session from the results screen. Loads a small quantized model from CDN at runtime (never part of `npm install` — see the comment at the top of `src/lib/ai-worker.ts` for why)

## Deploying (Cloudflare Pages)

```bash
npm run build
```

Point Pages at this repo with build command `npm run build` and output directory `dist`. Set `VITE_TMDB_TOKEN` (and optionally `VITE_OMDB_KEY`) as environment variables in the Pages project settings — `.env` is gitignored and never committed.

## Contributing

Issues and PRs are welcome. Before opening a PR:

```bash
npm run typecheck   # must be clean — strict mode, no exceptions
npm run build       # must succeed
```

Keep the "no framework" constraint in mind — new UI goes through `src/lib/dom.ts`'s `el()` helper, not a new dependency.

## Security

`npm audit` reports 0 vulnerabilities as of this rebuild. See [SECURITY.md](./SECURITY.md) for the reporting policy. Dependabot is configured for weekly npm checks.

## License

Apache 2.0 — see [LICENSE](./LICENSE).
