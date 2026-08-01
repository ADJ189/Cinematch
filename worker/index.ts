// worker/index.ts
//
// CineMatch's Cloudflare Worker entry point. This app deploys as a real
// Worker (Workers Static Assets), not a Pages project — wrangler.jsonc's
// `main` points here, and this file has two jobs:
//
//   1. Serve the built `dist/` output for everything that isn't an API
//      route, via the `ASSETS` binding.
//   2. Handle POST /api/recommend — the optional Workers AI re-ranking
//      pass (ported from the old functions/api/recommend.ts Pages
//      Function; behavior is unchanged, it's just a genuine Worker route
//      now). This is an enhancement layer only: the client-side engine
//      (src/lib/engine.ts + src/lib/tmdb.ts) works completely without it.
//
// It also stamps Cross-Origin-Opener-Policy / Cross-Origin-Embedder-Policy
// onto every asset response. Those two headers are what make a page
// "cross-origin isolated" — a hard browser requirement for
// SharedArrayBuffer, which is what lets the on-device AI reason-writer
// (src/lib/ai-worker.ts) run multi-threaded WASM instead of falling back
// to a single thread on any device without WebGPU. Without these headers
// the feature still works, it's just slower — this is what makes the fast
// path actually available.
//
// TMDB/OMDb keys are NOT handled here: they're VITE_-prefixed build-time
// env vars baked into the client bundle at `npm run build` (see README —
// set them as Cloudflare project variables, not Worker secrets, since
// Wrangler needs them present at build time, not request time).

export interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  // Optional: only present if the Workers AI binding is turned on for
  // this project in the Cloudflare dashboard (Settings → Bindings) —
  // declaring "ai" in wrangler.jsonc alone is not enough.
  AI?: {
    run(
      model: string,
      options: {
        messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
        temperature?: number;
        max_tokens?: number;
      }
    ): Promise<{ response: string }>;
  };
}

interface CandidateSummary {
  id: number;
  title: string;
  year: number;
  genres: string[];
  vibe: string[];
}

interface RecommendRequestBody {
  preferencesSummary: string;
  candidates: CandidateSummary[];
}

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

// Cross-origin isolation headers — see file header comment for why these
// matter beyond just being generically "secure defaults".
const ISOLATION_HEADERS: Record<string, string> = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

const MAX_CANDIDATES = 40;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/recommend') {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
      if (request.method === 'POST') return handleRecommend(request, env);
      return new Response('Method not allowed', { status: 405, headers: CORS });
    }

    const assetResponse = await env.ASSETS.fetch(request);
    // Cloudflare's asset Response is immutable — clone the headers onto a
    // new Response instead of mutating in place.
    const headers = new Headers(assetResponse.headers);
    for (const [key, value] of Object.entries(ISOLATION_HEADERS)) headers.set(key, value);
    return new Response(assetResponse.body, { status: assetResponse.status, statusText: assetResponse.statusText, headers });
  },
};

async function handleRecommend(request: Request, env: Env): Promise<Response> {
  if (!env.AI) {
    return Response.json(
      { error: 'AI binding not configured for this deployment.' },
      { status: 503, headers: CORS }
    );
  }

  let body: RecommendRequestBody;
  try {
    body = (await request.json()) as RecommendRequestBody;
  } catch {
    return Response.json({ error: 'Invalid JSON body.' }, { status: 400, headers: CORS });
  }

  const candidates = (body.candidates ?? []).slice(0, MAX_CANDIDATES);
  if (candidates.length === 0) {
    return Response.json({ error: 'No candidates provided.' }, { status: 400, headers: CORS });
  }

  const candidateList = candidates
    .map((c) => `- id:${c.id} "${c.title}" (${c.year}) [${[...c.genres, ...c.vibe].join(', ')}]`)
    .join('\n');

  const systemPrompt = `You re-rank a pre-filtered candidate list for CineMatch. You never invent titles — you only reorder and briefly explain the ids given. Output ONLY raw JSON, no markdown:
{ "ranking": [ { "id": number, "reason": string } ] }
"reason" must be a single specific sentence under 18 words, referencing the user's stated preferences. Include every id from the candidate list exactly once.`;

  const userPrompt = `User preferences: ${body.preferencesSummary || 'none stated'}

Candidates:
${candidateList}

Return the ranking, best match first.`;

  let rawResponse: string;
  try {
    const result = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: 900,
    });
    rawResponse = result.response?.trim() ?? '';
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown AI error';
    return Response.json({ error: `Workers AI call failed: ${msg}` }, { status: 502, headers: CORS });
  }

  const cleaned = rawResponse
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();

  let parsed: { ranking?: { id: number; reason: string }[] };
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return Response.json({ error: 'AI returned malformed JSON.', raw: cleaned }, { status: 422, headers: CORS });
  }

  const validIds = new Set(candidates.map((c) => c.id));
  const ranking = (parsed.ranking ?? []).filter((r) => validIds.has(r.id));

  return Response.json({ ranking }, { headers: CORS });
}
