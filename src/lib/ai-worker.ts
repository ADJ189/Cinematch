// src/lib/ai-worker.ts
//
// Runs the on-device explanation writer in a dedicated Worker so a slow
// download or decode never freezes the UI. The decision order below follows
// CineMatch-Local-AI-Engine-Policy.md:
//
//   1. Lightweight / data saver returns without touching Transformers.js.
//   2. Detect resources (heuristics, not exact RAM/GPU memory), including a
//      real navigator.gpu.requestAdapter() — `'gpu' in navigator` alone is
//      true on devices with no usable adapter.
//   3. Build an eligible candidate list (ai-policy.ts). Ineligible candidates
//      are never attempted just to prove they fail.
//   4. Prepare the runtime: try the CDN locations in order; do NOT override
//      `wasmPaths` (see note below); request multiple WASM threads only on a
//      cross-origin-isolated page.
//   5. Load ONE candidate at a time, with staged progress. Never download
//      several models up front.
//   6. A resolved pipeline is not "ready". Run one deterministic smoke
//      generation and validate the response; on failure dispose the
//      candidate and move to the next one.
//   7. Only then post `ready`.
//   8. Generation is serialised by a worker-side queue — the invariant holds
//      even if a caller fires many requests at once.
//   9. Deterministic decoding (no sampling), no chain-of-thought, strict
//      format checks. Invalid output becomes `null`, and the caller keeps the
//      rule-based reasons.
//
// This file intentionally uses `any` casts around postMessage/onmessage and
// the CDN module: the project's tsconfig only loads the "DOM" lib (not
// "webworker"), and the library is loaded from a CDN at runtime rather than
// being an npm dependency (see llm.ts for why).
//
// Note on `wasmPaths`: an earlier version pointed it at
// `@huggingface/transformers`'s own dist folder. That folder only holds the
// JS glue — the .wasm binaries ship in the separate `onnxruntime-web`
// package at whatever exact version transformers.js depends on — so every
// WASM load 404'd. The library's own default is version-correct by
// construction; leave it alone.

import {
  buildCandidates,
  buildMessages,
  SMOKE_MESSAGES,
  validateExplanation,
  validateSmoke,
  type Candidate,
  type ChatMessage,
  type ExplainInput,
  type ResourceSnapshot,
} from './ai-policy';
import type { AiMode } from './ai-settings';

const JS_CDN_SOURCES = [
  'https://esm.sh/@huggingface/transformers@4.2.0',
  'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0/+esm',
  'https://unpkg.com/@huggingface/transformers@4.2.0?module',
];

type Pipeline = ((input: ChatMessage[], options?: Record<string, unknown>) => Promise<unknown>) & {
  dispose?: () => Promise<void> | void;
};

interface LoadMsg {
  type: 'load';
  mode: AiMode;
  /** Main-thread hint: primary pointer is coarse (phones/tablets). */
  coarsePointer?: boolean;
}
interface GenerateMsg {
  type: 'generate';
  id: number;
  item: ExplainInput;
  quizSummary: string;
}
type InMsg = LoadMsg | GenerateMsg;

type Stage = 'detecting' | 'runtime' | 'downloading' | 'initializing' | 'verifying';

const ctx = self as unknown as {
  postMessage: (message: unknown) => void;
  onmessage: ((ev: { data: InMsg }) => void) | null;
  navigator: Navigator & {
    deviceMemory?: number;
    userAgentData?: { mobile?: boolean };
    gpu?: { requestAdapter(): Promise<unknown> };
  };
  crossOriginIsolated?: boolean;
};

let generator: Pipeline | null = null;
let active: Candidate | null = null;
let loading = false;
const queue: GenerateMsg[] = [];
let draining = false;

ctx.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'load') void load(msg);
  else if (msg.type === 'generate') {
    // Worker-side serial queue: requests are decoded strictly one at a time,
    // in arrival order, no matter how many callers post at once.
    queue.push(msg);
    void drain();
  }
};

function stage(s: Stage, candidate?: Candidate): void {
  ctx.postMessage({ type: 'stage', stage: s, model: candidate?.label, approxMb: candidate?.approxMb });
}

async function detectResources(coarsePointer: boolean): Promise<ResourceSnapshot> {
  const nav = ctx.navigator;
  const mem = typeof nav.deviceMemory === 'number' && nav.deviceMemory > 0 ? nav.deviceMemory : undefined;
  const cores =
    typeof nav.hardwareConcurrency === 'number' && nav.hardwareConcurrency > 0 ? Math.floor(nav.hardwareConcurrency) : 4;
  const mobile =
    nav.userAgentData?.mobile === true || coarsePointer || /Android|iPhone|iPad|iPod|Mobi/i.test(nav.userAgent || '');

  // A real adapter, not just the API surface.
  let webgpuAdapter = false;
  if (nav.gpu) {
    try {
      webgpuAdapter = (await nav.gpu.requestAdapter()) != null;
    } catch {
      webgpuAdapter = false;
    }
  }
  return { deviceMemoryGb: mem, cores, mobile, webgpuAdapter, crossOriginIsolated: ctx.crossOriginIsolated === true };
}

async function importFromFirstWorkingCdn(): Promise<{
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pipeline: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  env: any;
}> {
  let lastErr: unknown;
  for (const src of JS_CDN_SOURCES) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mod: any = await import(/* @vite-ignore */ src);
      if (mod?.pipeline) return mod;
      lastErr = new Error(`${src} loaded but had no pipeline export`);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('The AI runtime could not be loaded from any source.');
}

/** Pulls the assistant's text out of a chat-format pipeline result. */
function extractReply(out: unknown): string | null {
  const first = Array.isArray(out) ? (out[0] as { generated_text?: unknown } | undefined) : undefined;
  const text = first?.generated_text;
  if (!Array.isArray(text)) return null;
  const last = text[text.length - 1] as { role?: unknown; content?: unknown } | undefined;
  return last && last.role === 'assistant' && typeof last.content === 'string' ? last.content : null;
}

async function disposeGenerator(g: Pipeline | null): Promise<void> {
  try {
    await g?.dispose?.();
  } catch {
    // Best effort — the worker may be terminated right after anyway.
  }
}

function describeError(err: unknown): string {
  const text = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  return text.replace(/\s+/g, ' ').trim().slice(0, 160);
}

async function load(msg: LoadMsg): Promise<void> {
  if (generator && active) {
    postReady(active);
    return;
  }
  if (loading) return;
  loading = true;

  try {
    if (msg.mode === 'lightweight') {
      ctx.postMessage({ type: 'error', message: 'Lightweight mode is on, so no AI model is loaded.' });
      return;
    }

    stage('detecting');
    const resources = await detectResources(msg.coarsePointer === true);
    const candidates = buildCandidates(msg.mode, resources);
    if (candidates.length === 0) {
      ctx.postMessage({ type: 'error', message: 'No on-device model is suitable for this device.' });
      return;
    }

    stage('runtime');
    const { pipeline, env } = await importFromFirstWorkingCdn();
    env.allowLocalModels = false;
    env.useBrowserCache = true;
    if (env.backends?.onnx?.wasm) {
      // Multi-threaded WASM needs a SharedArrayBuffer, which the browser only
      // grants on a cross-origin-isolated page (COOP/COEP — see
      // worker/index.ts). Requesting >1 thread without that throws on most
      // onnxruntime-web builds, so only ask when the page is isolated.
      env.backends.onnx.wasm.numThreads = resources.crossOriginIsolated ? Math.max(1, resources.cores - 1) : 1;
    }

    let lastFailure = '';
    for (const candidate of candidates) {
      let built: Pipeline | null = null;
      try {
        stage('downloading', candidate);
        built = (await pipeline('text-generation', candidate.repo, {
          revision: candidate.revision,
          device: candidate.backend,
          dtype: candidate.dtype,
          progress_callback: makeProgressReporter(candidate),
        })) as Pipeline;

        // A resolved pipeline is not a ready model: prove it can answer.
        stage('verifying', candidate);
        const out = await built(SMOKE_MESSAGES, { max_new_tokens: 12, do_sample: false });
        if (!validateSmoke(extractReply(out))) throw new Error('The start-up check returned no usable text.');

        generator = built;
        active = candidate;
        postReady(candidate);
        return;
      } catch (err) {
        lastFailure = `${candidate.label} (${candidate.backend}): ${describeError(err) || 'failed to start'}`;
        await disposeGenerator(built);
      }
    }
    ctx.postMessage({
      type: 'error',
      message: `No on-device model could be started on this device. Last attempt: ${lastFailure}`,
    });
  } catch (err) {
    ctx.postMessage({ type: 'error', message: describeError(err) || 'Failed to load the on-device model.' });
  } finally {
    loading = false;
  }
}

function postReady(c: Candidate): void {
  ctx.postMessage({
    type: 'ready',
    model: c.label,
    backend: c.backend,
    dtype: c.dtype,
    approxMb: c.approxMb,
  });
}

/** Aggregates per-file download events into one monotonic percentage and
 * announces the "initializing" stage once every started file has finished. */
function makeProgressReporter(candidate: Candidate): (p: unknown) => void {
  const files = new Map<string, { loaded: number; total: number; done: boolean }>();
  const expectedBytes = candidate.approxMb * 1_000_000;
  let lastPct = -1;
  let announcedInit = false;

  return (raw) => {
    const p = raw as { status?: string; file?: string; name?: string; loaded?: number; total?: number } | null;
    if (!p || typeof p.status !== 'string') return;
    const name = p.file ?? p.name ?? '';
    if (!name) return;

    if (p.status === 'initiate') {
      if (!files.has(name)) files.set(name, { loaded: 0, total: 0, done: false });
    } else if (p.status === 'progress' || p.status === 'download') {
      const f = files.get(name) ?? { loaded: 0, total: 0, done: false };
      if (typeof p.loaded === 'number') f.loaded = p.loaded;
      if (typeof p.total === 'number') f.total = p.total;
      files.set(name, f);
    } else if (p.status === 'done') {
      const f = files.get(name) ?? { loaded: 0, total: 0, done: false };
      f.done = true;
      if (f.total > 0) f.loaded = f.total;
      files.set(name, f);
    }

    let loaded = 0;
    let total = 0;
    let allDone = files.size > 0;
    for (const f of files.values()) {
      loaded += f.loaded;
      total += f.total;
      if (!f.done) allDone = false;
    }
    // Weigh against the expected weight-file size so the bar doesn't jump
    // backwards when the large file starts after the small ones finish.
    const denominator = Math.max(total, expectedBytes);
    const pct = Math.min(99, Math.floor((loaded / denominator) * 100));
    if (pct > lastPct) {
      lastPct = pct;
      ctx.postMessage({ type: 'progress', pct, model: candidate.label });
    }
    // The small config/tokenizer files finish long before the weights, so
    // "every started file is done" alone is not enough: also require that
    // roughly the whole weight file has arrived. If the real file is a bit
    // smaller than the approximate size, the stage simply stays on
    // "downloading" until the pipeline resolves and "verifying" starts.
    if (allDone && !announcedInit && loaded >= expectedBytes * 0.95) {
      announcedInit = true;
      stage('initializing', candidate);
    }
  };
}

async function drain(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    for (let next = queue.shift(); next; next = queue.shift()) {
      await generateOne(next);
    }
  } finally {
    draining = false;
  }
}

async function generateOne(msg: GenerateMsg): Promise<void> {
  // Lets the main thread start its per-request timeout now that this request
  // is actually being decoded (not merely waiting in the queue).
  ctx.postMessage({ type: 'started', id: msg.id });
  if (!generator || !active) {
    ctx.postMessage({ type: 'result', id: msg.id, text: null });
    return;
  }
  try {
    const out = await generator(buildMessages(msg.item, msg.quizSummary), {
      max_new_tokens: active.maxNewTokens,
      do_sample: false,
    });
    ctx.postMessage({ type: 'result', id: msg.id, text: validateExplanation(extractReply(out)) });
  } catch {
    ctx.postMessage({ type: 'result', id: msg.id, text: null });
  }
}
