// src/lib/llm.ts
//
// Optional local LLM used to write a single, more natural "why this pick"
// sentence per result. Runs entirely in a Web Worker via transformers.js
// (WebGPU when available, WASM otherwise) — no server call, no API key,
// no data leaves the device, and generation never blocks the UI thread.
// See ai-worker.ts for what changed and why; this file is just the
// main-thread wrapper: it owns the worker, request/response correlation,
// timeouts (so a hung load or a hung generation can never wedge the "on"
// button forever), and a small in-memory cache so re-rendering the same
// result twice doesn't re-run inference.
//
// Deliberately NOT an npm dependency: @huggingface/transformers pulls in
// onnxruntime-node and sharp as hard dependencies for its Node backend,
// which means a native-binary postinstall step that has nothing to do
// with this being a 100%-browser feature. Instead, the worker loads the
// browser build straight from a CDN, only when a user explicitly opts in
// from the results screen — so `npm install` stays small and clean.

import type { ScoredItem } from './types';

export type LlmStatus = 'unavailable' | 'loading' | 'ready' | 'error';

const LOAD_TIMEOUT_MS = 60_000;
const GENERATE_TIMEOUT_MS = 20_000;

type WorkerOutMsg =
  | { type: 'ready'; device?: string; tier?: string; model?: string }
  | { type: 'progress'; pct: number }
  | { type: 'error'; message: string }
  | { type: 'result'; id: number; text: string | null };

let worker: Worker | null = null;
let status: LlmStatus = 'unavailable';
let statusDetail = '';
let loadingPromise: Promise<void> | null = null;
let nextRequestId = 1;

let loadWaiters: { onProgress?: (pct: number) => void; resolve: () => void; reject: (e: Error) => void } | null =
  null;
const genWaiters = new Map<number, (text: string | null) => void>();
const sentenceCache = new Map<string, string>();

export function getLlmStatus(): LlmStatus {
  return status;
}

/** A short human-readable reason for the current status — shown in the UI on error. */
export function getLlmStatusDetail(): string {
  return statusDetail;
}

function getWorker(): Worker {
  if (worker) return worker;

  worker = new Worker(new URL('./ai-worker.ts', import.meta.url), { type: 'module' });

  worker.addEventListener('message', (e: MessageEvent<WorkerOutMsg>) => {
    const msg = e.data;
    if (msg.type === 'progress') {
      loadWaiters?.onProgress?.(msg.pct);
    } else if (msg.type === 'ready') {
      status = 'ready';
      const speed = msg.device === 'webgpu' ? 'WebGPU' : 'WASM (CPU)';
      const quality = msg.tier === 'low' ? 'lightweight' : msg.tier === 'mid' ? 'standard' : 'full-quality';
      statusDetail = `Running on ${speed} — ${quality} model`;
      loadWaiters?.resolve();
      loadWaiters = null;
    } else if (msg.type === 'error') {
      status = 'error';
      statusDetail = msg.message || "This browser can't run the on-device model.";
      loadWaiters?.reject(new Error(statusDetail));
      loadWaiters = null;
    } else if (msg.type === 'result') {
      genWaiters.get(msg.id)?.(msg.text);
      genWaiters.delete(msg.id);
    }
  });

  worker.addEventListener('error', () => {
    status = 'error';
    statusDetail = 'The on-device model crashed unexpectedly.';
    loadWaiters?.reject(new Error(statusDetail));
    loadWaiters = null;
    // The worker instance may be left in a broken state after an uncaught
    // error — drop it so the next enableLocalAi() call starts a clean one
    // instead of retrying against something already dead.
    worker?.terminate();
    worker = null;
  });

  return worker;
}

/** Downloads and initializes a small quantized instruction model. Idempotent. */
export async function enableLocalAi(onProgress?: (pct: number) => void): Promise<void> {
  if (status === 'ready') return;
  if (loadingPromise) return loadingPromise;

  status = 'loading';
  statusDetail = '';
  const w = getWorker();

  loadingPromise = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      loadWaiters = null;
      status = 'error';
      statusDetail = 'Timed out downloading the model — try again on a faster connection.';
      reject(new Error(statusDetail));
    }, LOAD_TIMEOUT_MS);

    loadWaiters = {
      onProgress,
      resolve: () => {
        clearTimeout(timer);
        resolve();
      },
      reject: (e) => {
        clearTimeout(timer);
        reject(e);
      },
    };

    w.postMessage({ type: 'load' });
  }).finally(() => {
    loadingPromise = null;
  });

  return loadingPromise;
}

/**
 * Rewrites a result's rule-based reasons into one natural sentence.
 * Falls back to joining the original reasons if the model isn't loaded,
 * the request times out, or generation fails — this is always an
 * enhancement, never a dependency for using the app.
 */
export async function explainPick(item: ScoredItem, quizSummary: string): Promise<string> {
  const fallback = item.reasons.join(' · ');
  if (status !== 'ready' || !worker) return fallback;

  const cacheKey = `${item.id}:${quizSummary}`;
  const cached = sentenceCache.get(cacheKey);
  if (cached) return cached;

  const w = worker;
  const id = nextRequestId++;

  const text = await new Promise<string | null>((resolve) => {
    const timer = setTimeout(() => {
      genWaiters.delete(id);
      resolve(null);
    }, GENERATE_TIMEOUT_MS);

    genWaiters.set(id, (text) => {
      clearTimeout(timer);
      resolve(text);
    });

    w.postMessage({
      type: 'generate',
      id,
      item: { title: item.title, year: item.year, reasons: item.reasons },
      quizSummary,
    });
  });

  if (text) sentenceCache.set(cacheKey, text);
  return text && text.length > 0 ? text : fallback;
}
