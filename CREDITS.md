# Credits

CineMatch is built on top of a handful of external data sources,
open-source libraries, and design references. None of these projects
endorse CineMatch — this file exists to attribute the work this project
depends on.

## Data

- **[TMDB](https://www.themoviedb.org/)** — the core catalog: titles,
  genres, cast/crew, recommendations/similarity, and watch-provider
  data. This product uses the TMDB API but is not endorsed or certified
  by TMDB. Streaming/watch-provider data on TMDB is sourced from
  **[JustWatch](https://www.justwatch.com/)**.
- **[OMDb API](https://www.omdbapi.com/)** — optional secondary rating
  signal (Rotten Tomatoes, Metacritic, IMDb scores).
- **[Letterboxd](https://letterboxd.com/)** — `letterboxd.ts` parses a
  user-exported `ratings.csv` (Settings → Data → Export) as a taste
  calibration shortcut. CineMatch has no association with Letterboxd
  and does not access their API or servers; the importer only reads a
  file the user already exported themselves.

## Libraries

- **[Vite](https://vitejs.dev/)** — build tool and dev server.
- **[TypeScript](https://www.typescriptlang.org/)** — language.
- **[Wrangler](https://developers.cloudflare.com/workers/wrangler/)** —
  Cloudflare Workers CLI, used for local dev and deployment.
- **[`@huggingface/transformers`](https://huggingface.co/docs/transformers.js)**
  (transformers.js) — powers the optional on-device AI, loaded from a
  CDN at runtime rather than bundled; see `src/lib/ai-worker.ts`.

## Fonts

- **[Sora](https://fonts.google.com/specimen/Sora)**,
  **[Inter](https://fonts.google.com/specimen/Inter)**, and
  **[JetBrains Mono](https://fonts.google.com/specimen/JetBrains+Mono)**
  — served via Google Fonts, all licensed under the
  [SIL Open Font License](https://scripts.sil.org/OFL).

## Design references

- The local-profile popover, avatar system, and overall editorial feel
  take stylistic inspiration from **[SeriesGraph](https://seriesgraph.com/)**
  — fonts, theming, and layout influence only; no code or assets were
  copied.
- The "click a cast member to see their other work" pattern on title
  pages is inspired by the UX of self-hosted media servers like
  **[Jellyfin](https://jellyfin.org/)** and **[Plex](https://www.plex.tv/)**.
  CineMatch is a client-only app with no local media library and shares
  no code with either project — the credit is for the interaction
  pattern, not an implementation.

## License

CineMatch itself is licensed under the Apache License 2.0 — see
[LICENSE](./LICENSE). Third-party libraries retain their own licenses;
see `package.json` / `package-lock.json` for the full dependency list.
