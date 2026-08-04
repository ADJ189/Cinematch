# Privacy

CineMatch has no server-side account system and no analytics. This
document is a plain-language explanation of what data the app touches
and where it goes, since "trust me" isn't a privacy policy. It's not a
legal document — if you're deploying your own fork commercially and need
one, write one for your deployment; this describes the app's behavior,
not a contractual promise.

## The short version

Nothing about you is stored on any server this project runs. Everything
CineMatch "remembers" about you lives in your browser's `localStorage`,
on your device only, and the only things sent over the network are the
direct API calls needed to fetch and score titles.

## What's stored locally, on your device

`src/lib/profile.ts` creates a **local profile** automatically on first
visit — not a server account, just a private identity scoped to that one
browser:

- A randomly generated display name and avatar (you can change either)
- Your rating history (which titles you rated, and how)
- Your watchlist
- Your streaming-region preference, if you've picked one (`region.ts`)
- Your theme preference (light/dark, `theme.ts`)

None of this is sent anywhere. It's readable and deletable like any
other localStorage data for this site — clearing your browser's site
data for this domain removes it, or use **Reset my data** in the profile
popover (header → profile icon) for a one-click reset from inside the
app.

If your browser blocks localStorage (private/incognito mode, storage
disabled), the app still works — ratings and the watchlist just won't
survive closing the tab, and the profile popover tells you this plainly
rather than pretending otherwise.

## What's sent over the network, and to whom

- **TMDB** (`api.themoviedb.org`) — nearly every action (browsing,
  rating, searching a title/person, checking streaming availability)
  sends a request to TMDB with whatever's needed for that specific
  query (e.g. a title id, a search string, a genre filter). TMDB's own
  [privacy policy](https://www.themoviedb.org/privacy-policy) governs
  what they do with request data, including your IP address as seen by
  their servers — this project doesn't control that.
- **OMDb** (`omdbapi.com`) — optional; only called if you've configured
  `VITE_OMDB_KEY`. Same IP-address caveat as above, governed by
  [OMDb's terms](https://www.omdbapi.com/legal.htm).
- **JustWatch data via TMDB** — streaming/watch-provider availability
  is fetched through the same TMDB request path, not a separate call to
  JustWatch directly.
- **The optional on-device AI** (`src/lib/ai-worker.ts`) downloads a
  model from a CDN (Hugging Face or a mirror) the first time you opt
  in, then runs entirely in your browser via WebGPU or WASM. No title
  data, rating, or prompt is ever sent anywhere for this — "on-device"
  is literal.
- **The optional `/api/recommend` Worker route** (`worker/index.ts`) —
  only reachable if the deployment has Cloudflare Workers AI enabled,
  and nothing in the current app actually calls it yet. If it is used,
  it receives a pre-filtered candidate list (title id/name/year/genre)
  and a short preferences summary — never your raw ratings, profile, or
  any personally identifying data — and returns a re-ranking. Cloudflare
  processes this request per Cloudflare's own
  [privacy policy](https://www.cloudflare.com/privacypolicy/).
- **Hosting** — the app itself is served by Cloudflare Workers; loading
  any page necessarily exposes your IP address to Cloudflare's edge
  network, the same as any website.

## What CineMatch never does

- No analytics or usage tracking of any kind.
- No cookies set by this app (Cloudflare's own infrastructure cookies,
  if any, are outside this project's control).
- No advertising, no ad-tech scripts, no third-party trackers.
- No account system, no email collection, no login.
- The Letterboxd CSV importer (`letterboxd.ts`) only reads a file you
  choose from your own device and never uploads it anywhere — parsing
  happens entirely client-side.

## Third-party services

This project depends on external APIs it doesn't control the data
practices of — see [CREDITS.md](./CREDITS.md) for the full list (TMDB,
OMDb, JustWatch data, Hugging Face's CDN for the optional AI model).
Review their own privacy policies if you have specific concerns.

## Questions

Open an issue, or use GitHub's private reporting if the question
concerns something you don't want public — see
[SECURITY.md](./SECURITY.md) for how.
