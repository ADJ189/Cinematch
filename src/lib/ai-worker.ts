// src/lib/ai-worker.ts
//
// Runs the on-device model in a dedicated Worker so a slow decode never
// freezes the results screen. This file intentionally uses `any` casts
// around postMessage/onmessage: the project's tsconfig only loads the
// "DOM" lib (not "webworker"), and adding the webworker lib globally would
// conflict with DOM types used everywhere else. Casting here keeps
// `tsc --noEmit` clean without splitting the project into two tsconfigs
// for one small file.
//
// What this fixes vs. earlier versions, and why it still failed sometimes:
//   1. No dtype/device was specified at all originally, so the loader
//      pulled whatever a backend's default happened to be — often a full
//      fp32 build, several hundred MB more than a 0.5B model needs. Fixed
//      by requesting the smallest quantization each backend supports.
//   2. A single CDN (esm.sh) and a single model repo were hardcoded. Any
//      one of: that CDN being blocked by a network/proxy, that CDN's
//      current deploy having an issue, or that specific model repo being
//      rate-limited or briefly unavailable on the Hugging Face Hub, took
//      the whole feature down with no way to recover. Fixed by trying a
//      short list of CDNs for the library itself, and a short list of
//      model repos per resource tier — each combination is tried in turn
//      until one actually finishes loading.
//   3. No device fallback existed — if WebGPU init failed for any reason
//      the whole thing errored out instead of trying WASM.
//   4. The resource tier (which model + quantization to request) was fixed
//      regardless of device. A phone on a metered connection and a
//      16-core desktop with a discrete GPU got the identical request. Now
//      picks a tier from navigator.deviceMemory / hardwareConcurrency /
//      WebGPU availability / mobile detection, smallest-download-first.
//   5. WASM execution only ever used a single thread. Multi-threaded WASM
//      (SharedArrayBuffer-backed) is meaningfully faster on multi-core
//      devices when WebGPU isn't available — now explicitly sized to
//      leave one core free for the UI instead of defaulting to 1 or maxing
//      every core.

const JS_CDN_SOURCES = [
  'https://esm.sh/@huggingface/transformers@4.2.0',
  'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0/+esm',
  'https://unpkg.com/@huggingface/transformers@4.2.0?module',
];
const WASM_CDN_DIRS = [
  'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0/dist/',
  'https://unpkg.com/@huggingface/transformers@4.2.0/dist/',
];

const ctx = self as unknown as {
  postMessage: (message: unknown) => void;
  onmessage: ((ev: { data: InMsg }) => void) | null;
  navigator: Navigator & { deviceMemory?: number };
};

type ChatMessage = { role: 'system' | 'user'; content: string };
type Pipeline = (
  input: ChatMessage[],
  options?: Record<string, unknown>
) => Promise<{ generated_text: ChatMessage[] }[]>;

interface LoadMsg {
  type: 'load';
}
interface GenerateMsg {
  type: 'generate';
  id: number;
  item: { title: string; year: number; reasons: string[] };
  quizSummary: string;
}
type InMsg = LoadMsg | GenerateMsg;

interface ResourceTier {
  name: 'high' | 'mid' | 'low';
  models: string[]; // tried in order until one loads
  device: 'webgpu' | 'wasm';
  dtype: string;
  maxNewTokens: number;
}

let generator: Pipeline | null = null;
let maxNewTokens = 32;

ctx.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'load') void load();
  else if (msg.type === 'generate') void generate(msg);
};

/** Cheap, synchronous device signal — no permissions prompt, no async cost. */
function detectResourceTier(): ResourceTier[] {
  const nav = ctx.navigator;
  const hasWebGpu = 'gpu' in nav;
  const mem = nav.deviceMemory; // GB, Chromium-only; undefined elsewhere
  const cores = nav.hardwareConcurrency || 4;
  const isMobile = /Android|iPhone|iPad|iPod|Mobi/i.test(nav.userAgent || '');

  const high: ResourceTier = {
    name: 'high',
    models: ['onnx-community/Qwen2.5-0.5B-Instruct', 'Xenova/Qwen1.5-0.5B-Chat'],
    device: 'webgpu',
    dtype: 'q4',
    maxNewTokens: 40,
  };
  const mid: ResourceTier = {
    name: 'mid',
    models: ['onnx-community/Qwen2.5-0.5B-Instruct', 'Xenova/Qwen1.5-0.5B-Chat'],
    device: 'wasm',
    dtype: 'q8',
    maxNewTokens: 32,
  };
  const low: ResourceTier = {
    name: 'low',
    models: ['HuggingFaceTB/SmolLM2-360M-Instruct', 'onnx-community/SmolLM2-360M-Instruct'],
    device: 'wasm',
    dtype: 'q4',
    maxNewTokens: 24,
  };

  // Known-low-resource signal (small RAM, very few cores, or mobile with no
  // WebGPU) → start small and cheap instead of attempting a build that's
  // likely to stall.
  const lowResource = (mem !== undefined && mem <= 4) || cores <= 2 || (isMobile && !hasWebGpu);

  if (lowResource) return [low, mid];
  if (hasWebGpu) return [high, mid, low];
  return [mid, low];
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
  throw lastErr instanceof Error ? lastErr : new Error('No CDN source for @huggingface/transformers loaded.');
}

async function load(): Promise<void> {
  if (generator) {
    ctx.postMessage({ type: 'ready' });
    return;
  }

  try {
    const { pipeline, env } = await importFromFirstWorkingCdn();
    env.allowLocalModels = false;
    env.useBrowserCache = true;
    if (env.backends?.onnx?.wasm) {
      // Hardware acceleration for the WASM path: multi-threaded execution
      // sized to leave one core free for the UI thread, instead of the
      // library's default of a single thread.
      const cores = ctx.navigator.hardwareConcurrency || 4;
      env.backends.onnx.wasm.numThreads = Math.max(1, cores - 1);
      env.backends.onnx.wasm.wasmPaths = WASM_CDN_DIRS[0];
    }

    const tiers = detectResourceTier();
    let lastErr: unknown;

    for (const tier of tiers) {
      for (const modelId of tier.models) {
        try {
          generator = (await pipeline('text-generation', modelId, {
            device: tier.device,
            dtype: tier.dtype,
            progress_callback: (p: { status?: string; progress?: number }) => {
              if (p.status === 'progress' && typeof p.progress === 'number') {
                ctx.postMessage({ type: 'progress', pct: Math.round(p.progress) });
              }
            },
          })) as unknown as Pipeline;
          maxNewTokens = tier.maxNewTokens;
          ctx.postMessage({ type: 'ready', device: tier.device, tier: tier.name, model: modelId });
          return;
        } catch (err) {
          lastErr = err;
        }
      }
      // WASM wasmPaths only needs the primary CDN; if wasm itself is the
      // failure point, try the mirror before moving to the next tier.
      if (tier.device === 'wasm' && env.backends?.onnx?.wasm && WASM_CDN_DIRS[1]) {
        env.backends.onnx.wasm.wasmPaths = WASM_CDN_DIRS[1];
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('No supported backend/model combination loaded.');
  } catch (err) {
    ctx.postMessage({
      type: 'error',
      message: err instanceof Error ? err.message : 'Failed to load the on-device model.',
    });
  }
}

async function generate(msg: GenerateMsg): Promise<void> {
  if (!generator) {
    ctx.postMessage({ type: 'result', id: msg.id, text: null });
    return;
  }

  try {
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content:
          'You recommend one movie or show in a single warm, specific sentence, under 20 words. No preamble, no quotes.',
      },
      {
        role: 'user',
        content: `User wants: ${msg.quizSummary}\nTitle: ${msg.item.title} (${msg.item.year})\nSignals: ${msg.item.reasons.join('; ')}`,
      },
    ];

    const out = await generator(messages, { max_new_tokens: maxNewTokens, temperature: 0.6, do_sample: true });
    const reply = out[0]?.generated_text?.at(-1)?.content?.trim();
    ctx.postMessage({
      type: 'result',
      id: msg.id,
      text: reply && reply.length > 0 && reply.length < 220 ? reply : null,
    });
  } catch {
    ctx.postMessage({ type: 'result', id: msg.id, text: null });
  }
}
