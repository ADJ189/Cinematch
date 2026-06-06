# AI Recommendation Setup

CineMatch uses **Cloudflare Workers AI** (Llama 3.1 8B Instruct) for recommendations
when deployed on Cloudflare Pages. It falls back automatically to the local scoring
engine if the AI endpoint is unreachable (e.g. local `vite dev`).

## How it works

```
User completes quiz & ratings
          │
          ▼
  Results.svelte calls
  POST /api/recommend
          │
  ┌───────┴────────┐
  │  AI available? │
  └───────┬────────┘
     yes  │  no (timeout / error)
          │             │
          ▼             ▼
  Llama 3.1 8B   Local RecommendationEngine
  (Workers AI)   (src/lib/engine.ts)
          │             │
          └──────┬──────┘
                 ▼
          Results displayed
     (badge shows which mode)
```

## Deploying to Cloudflare Pages

1. **Push to GitHub** and connect the repo to Cloudflare Pages.

2. **Build settings:**
   - Framework: None (or Vite)
   - Build command: `npm run build`
   - Output directory: `dist`

3. **Enable Workers AI** in your Cloudflare dashboard:
   - Pages project → Settings → Functions → AI Bindings
   - Add binding with variable name: `AI`

   Or confirm it's present in `wrangler.jsonc` (already done):
   ```jsonc
   {
     "ai": { "binding": "AI" }
   }
   ```

4. **Deploy** — the `/api/recommend` Pages Function is picked up automatically
   from the `functions/` directory.

5. **(Optional) TMDB API key** for live posters on AI results:
   - Add env var `VITE_TMDB_KEY` in Pages → Settings → Environment Variables
   - Free key at https://www.themoviedb.org/settings/api

## Local development

```bash
npm run dev          # Vite only — AI falls back to local engine (expected)
npx wrangler pages dev dist --ai  # Full stack with AI binding
```

## Costs

Workers AI free tier: **10,000 "neurons"/day** — more than enough for a
personal or demo project. No credit card needed.

Model: `@cf/meta/llama-3.1-8b-instruct`
