# CineMatch

A fast, framework-free movie & TV recommendation engine. Six quick questions, a few titles you already know, and a live pull from thousands of real TMDB titles — matched to you instead of re-sorting a fixed list.

<p align="center"><img src="public/logo.svg" width="120" alt="CineMatch logo" /></p>

## Why this rebuild exists

The previous version (Svelte-based) always surfaced the same handful of titles regardless of quiz answers. Root cause, for anyone curious: it fell back to a client-side scorer running against a **hardcoded 30-title catalog**, and that scorer's "quality bonus" outweighed the actual quiz signal. This version fixes both problems at the architecture level — see [CHANGELOG.md](./CHANGELOG.md) for the full list.

## Stack

Vanilla TypeScript + Vite. No framework. The UI is four screens and a tiny pub-sub store (`src/lib/store.ts`) — not enough surface area to justify a compiler-driven framework, and it keeps the bundle small (~5 kB gzipped JS on first paint).

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
    tmdb.ts        live catalog — /discover/movie + /discover/tv, genre-mapped, era-classified
    engine.ts      scoring model (quiz + ratings → matchPct + reasons)
    omdb.ts        optional secondary rating signal
    letterboxd.ts  parses a Letterboxd ratings.csv export for taste calibration
    llm.ts         optional on-device AI reason-writer, loaded from CDN only if enabled
    fluid.ts       the Navier-Stokes canvas background, ported as-is
    store.ts       ~40-line pub-sub store — the entire "framework"
    dom.ts         tiny element-builder helper
  screens/         landing, quiz, rating, results — one module each
  data/            quiz questions, taste-calibration seed titles
functions/api/
  recommend.ts     OPTIONAL Cloudflare Workers AI re-ranking pass
```

**The client-side engine is fully self-sufficient.** `functions/api/recommend.ts` is an enhancement layer, not a dependency — the app works completely without Workers AI enabled. If you do want it, you must turn the AI binding on in the Cloudflare Pages dashboard (Settings → Functions), not just declare it in `wrangler.jsonc` — that mismatch was the original cause of the old app's silent fallback.

## Connectors

- **TMDB** — required, the live catalog source
- **OMDb** — optional, adds Rotten Tomatoes/Metacritic/IMDb as a scoring signal
- **Letterboxd** — optional, import a `ratings.csv` export to skip manual re-rating
- **On-device AI** — optional, opt-in per session from the results screen. Loads a small quantized model from CDN at runtime (never part of `npm install` — see the comment at the top of `src/lib/llm.ts` for why)

## Deploying (Cloudflare Pages)

```bash
npm run build
```

Point Pages at this repo with build command `npm run build` and output directory `dist`. Set `VITE_TMDB_TOKEN` (and optionally `VITE_OMDB_KEY`) as environment variables in the Pages project settings — `.env` is gitignored and never committed.

## Security

`npm audit` reports 0 vulnerabilities as of this rebuild. See [SECURITY.md](./SECURITY.md) for the reporting policy. Dependabot is configured for weekly npm checks.

## License

Apache 2.0 — see [LICENSE](./LICENSE).
