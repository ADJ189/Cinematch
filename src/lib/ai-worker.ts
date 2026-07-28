// src/lib/ai-worker.ts
//
// Runs the on-device model in a dedicated Worker so a slow WASM decode
// never freezes the results screen. This file intentionally uses `any`
// casts around postMessage/onmessage: the project's tsconfig only loads
// the "DOM" lib (not "webworker"), and adding the webworker lib globally
// would conflict with DOM types used everywhere else. Casting here keeps
// `tsc --noEmit` clean without splitting the project into two tsconfigs
// for one small file.
//
// Fixes vs. the previous main-thread version:
//   1. No dtype was specified before, so the loader pulled whatever the
//      backend's default happened to be — full fp32 on WebGPU, which is
//      several hundred MB more than necessary for a 0.5B model and the
//      most likely reason loads stalled out or ran out of memory on
//      ordinary laptops and most phones.
//   2. No device fallback existed — if WebGPU init failed for any reason
//      (unsupported browser, blocked by a corporate policy, out of GPU
//      memory) the whole feature just errored out instead of trying WASM.
//   3. The wasm binary path was left to esm.sh's default resolution,
//      which is not always reliable for onnxruntime-web's sibling .wasm
//      files; pointing it at jsdelivr explicitly removes that failure mode.
//   4. Prompts were a raw string spliced with `.split('Sentence:')`. Qwen
//      is an instruct model — it expects the chat template. Passing a
//      proper messages array lets the library apply that template and
//      return structured output instead of us guessing where the prompt
//      ends and the completion begins.

const CDN_JS = 'https://esm.sh/@huggingface/transformers@4.2.0';
const CDN_WASM_DIR = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0/dist/';
const MODEL_ID = 'onnx-community/Qwen2.5-0.5B-Instruct';

const ctx = self as unknown as {
  postMessage: (message: unknown) => void;
  onmessage: ((ev: { data: InMsg }) => void) | null;
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

let generator: Pipeline | null = null;

ctx.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'load') void load();
  else if (msg.type === 'generate') void generate(msg);
};

async function load(): Promise<void> {
  if (generator) {
    ctx.postMessage({ type: 'ready' });
    return;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod: any = await import(/* @vite-ignore */ CDN_JS);
    const { pipeline, env } = mod;
    env.allowLocalModels = false;
    env.useBrowserCache = true;
    if (env.backends?.onnx?.wasm) {
      env.backends.onnx.wasm.wasmPaths = CDN_WASM_DIR;
    }

    const hasWebGpu = 'gpu' in (self as unknown as { navigator: Navigator }).navigator;
    // Smallest-download-first order per backend, so a flaky connection or a
    // memory-constrained device gets the best chance of finishing at all.
    const attempts: { device: 'webgpu' | 'wasm'; dtype: string }[] = hasWebGpu
      ? [
          { device: 'webgpu', dtype: 'q4' },
          { device: 'wasm', dtype: 'q8' },
        ]
      : [
          { device: 'wasm', dtype: 'q8' },
          { device: 'wasm', dtype: 'q4' },
        ];

    let lastErr: unknown;
    for (const attempt of attempts) {
      try {
        generator = (await pipeline('text-generation', MODEL_ID, {
          device: attempt.device,
          dtype: attempt.dtype,
          progress_callback: (p: { status?: string; progress?: number }) => {
            if (p.status === 'progress' && typeof p.progress === 'number') {
              ctx.postMessage({ type: 'progress', pct: Math.round(p.progress) });
            }
          },
        })) as unknown as Pipeline;
        ctx.postMessage({ type: 'ready', device: attempt.device });
        return;
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('No supported backend for this browser.');
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

    const out = await generator(messages, { max_new_tokens: 40, temperature: 0.6, do_sample: true });
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
