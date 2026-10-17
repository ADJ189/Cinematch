// src/lib/ai-policy.ts
//
// The pure (no DOM, no worker globals, no network) half of the local-AI
// engine: the model catalogue, which candidates a mode may attempt on a given
// device, the prompt, and the strict output-format checks. Keeping it pure
// means the worker, the settings UI and the unit tests all use one definition
// of the policy in Moodsift-Local-AI-Engine-Policy.md.
//
// IMPORTANT: model sizes below are approximate ONNX *weight-file* sizes only
// (repository artifact sizes) — not peak memory, not supporting files, and not
// measured performance. Revisions are pinned so a repository's default branch
// cannot silently change what gets downloaded.

import type { AiMode } from './ai-settings';

export type Backend = 'webgpu' | 'wasm';
export type Dtype = 'q4f16' | 'q8';
export type ModelFamily = 'qwen2.5-0.5b' | 'smollm2-360m' | 'smollm2-135m';

interface BackendSpec {
  dtype: Dtype;
  /** Approximate weight-file size in MB. */
  approxMb: number;
}

export interface ModelSpec {
  family: ModelFamily;
  label: string;
  repo: string;
  /** Pinned Hugging Face commit. */
  revision: string;
  webgpu: BackendSpec;
  wasm: BackendSpec;
}

export const MODELS: Readonly<Record<ModelFamily, ModelSpec>> = {
  'qwen2.5-0.5b': {
    family: 'qwen2.5-0.5b',
    label: 'Qwen2.5-0.5B',
    repo: 'onnx-community/Qwen2.5-0.5B-Instruct',
    revision: '516c8d04add8a80c5228f32102b57953b8d421a9',
    webgpu: { dtype: 'q4f16', approxMb: 483 },
    wasm: { dtype: 'q8', approxMb: 512 },
  },
  'smollm2-360m': {
    family: 'smollm2-360m',
    label: 'SmolLM2-360M',
    repo: 'onnx-community/SmolLM2-360M-Instruct-ONNX',
    revision: 'fe7c7db4c8921c9e3fa1c65cfd296fb3b1b1a8f9',
    webgpu: { dtype: 'q4f16', approxMb: 272 },
    wasm: { dtype: 'q8', approxMb: 363 },
  },
  'smollm2-135m': {
    family: 'smollm2-135m',
    label: 'SmolLM2-135M',
    repo: 'onnx-community/SmolLM2-135M-Instruct-ONNX',
    revision: 'b8a5c0f183b78c55955a5364f610c36668b5e681',
    webgpu: { dtype: 'q4f16', approxMb: 117 },
    wasm: { dtype: 'q8', approxMb: 136 },
  },
};

/** One concrete thing the worker may try to load: model + backend + dtype. */
export interface Candidate {
  /** Unique, stable id, e.g. `smollm2-360m:webgpu`. */
  key: string;
  family: ModelFamily;
  label: string;
  repo: string;
  revision: string;
  backend: Backend;
  dtype: Dtype;
  approxMb: number;
  maxNewTokens: number;
}

/** Heuristic device signals. None of these is exact available RAM/GPU memory. */
export interface ResourceSnapshot {
  /** navigator.deviceMemory in GB (Chromium only, capped at 8); undefined = unknown. */
  deviceMemoryGb: number | undefined;
  cores: number;
  mobile: boolean;
  /** True only when navigator.gpu.requestAdapter() returned an adapter supporting shader-f16. */
  webgpuAdapter: boolean;
  crossOriginIsolated: boolean;
}

// Generous enough that a 20-word sentence always finishes naturally; anything
// that runs on past MAX_WORDS is rejected rather than shown cut off.
const MAX_NEW_TOKENS = 48;

function candidate(family: ModelFamily, backend: Backend): Candidate {
  const spec = MODELS[family];
  const b = spec[backend];
  return {
    key: `${family}:${backend}`,
    family,
    label: spec.label,
    repo: spec.repo,
    revision: spec.revision,
    backend,
    dtype: b.dtype,
    approxMb: b.approxMb,
    maxNewTokens: MAX_NEW_TOKENS,
  };
}

/** Small RAM, very few cores, or a phone without a usable GPU adapter. */
export function isConstrained(r: ResourceSnapshot): boolean {
  return (
    (r.deviceMemoryGb !== undefined && r.deviceMemoryGb <= 4) ||
    r.cores <= 2 ||
    (r.mobile && !r.webgpuAdapter)
  );
}

/** Hard guardrail applied BEFORE a model is attempted. An ineligible
 * candidate is skipped, never "tried to prove it fails". */
export function isEligible(family: ModelFamily, backend: Backend, r: ResourceSnapshot): boolean {
  switch (family) {
    case 'smollm2-135m':
      return true;
    case 'smollm2-360m':
      return !isConstrained(r);
    case 'qwen2.5-0.5b': {
      // Unknown memory (Firefox, Safari) or any low-resource signal never
      // attempts the largest model automatically.
      if (isConstrained(r) || r.deviceMemoryGb === undefined || r.mobile) return false;
      if (backend === 'wasm') return r.deviceMemoryGb >= 8 && r.cores >= 6;
      return true;
    }
  }
}

const ORDER: Record<Exclude<AiMode, 'lightweight'>, readonly ModelFamily[]> = {
  best: ['qwen2.5-0.5b', 'smollm2-360m', 'smollm2-135m'],
  balanced: ['smollm2-360m', 'smollm2-135m'],
  fastest: ['smollm2-135m', 'smollm2-360m', 'qwen2.5-0.5b'],
};

/**
 * The ordered, eligible candidate list for a mode on this device.
 * - Lightweight returns [] — no model is ever attempted.
 * - Each family uses WebGPU when an adapter supports shader-f16, otherwise WASM.
 * - When WebGPU was the chosen backend, the smallest model's WASM build is
 *   appended once as a last verified fallback (a GPU can be present yet fail
 *   to initialise).
 */
export function buildCandidates(mode: AiMode, r: ResourceSnapshot): Candidate[] {
  if (mode === 'lightweight') return [];
  const backend: Backend = r.webgpuAdapter ? 'webgpu' : 'wasm';
  const list: Candidate[] = [];
  for (const family of ORDER[mode]) {
    if (isEligible(family, backend, r)) list.push(candidate(family, backend));
  }
  if (backend === 'webgpu') list.push(candidate('smollm2-135m', 'wasm'));
  return list;
}

// ── Prompt ──────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

export interface ExplainInput {
  title: string;
  year: number;
  reasons: string[];
}

/** Collapses whitespace, strips control characters and bounds the length of
 * anything that is interpolated into the prompt. */
export function cleanField(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  const flat = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return flat.length > max ? flat.slice(0, max).trim() : flat;
}

export const MAX_REASONS = 6;
export const MAX_REASON_CHARS = 160;
export const MAX_TITLE_CHARS = 120;
export const MAX_SUMMARY_CHARS = 300;

export function buildMessages(item: ExplainInput, quizSummary: string): ChatMessage[] {
  const reasons = (Array.isArray(item.reasons) ? item.reasons : [])
    .slice(0, MAX_REASONS)
    .map((r) => cleanField(r, MAX_REASON_CHARS))
    .filter(Boolean);
  const year = Number.isFinite(item.year) ? Math.trunc(item.year) : 0;
  return [
    {
      role: 'system',
      content:
        'You write one short sentence saying why a title fits what the viewer asked for. Use only the details provided; do not add facts. Maximum 20 words. Reply with the sentence only: no preamble, no quotes, no lists.',
    },
    {
      role: 'user',
      content: `User wants: ${cleanField(quizSummary, MAX_SUMMARY_CHARS) || 'no strong preference stated'}\nTitle: ${cleanField(item.title, MAX_TITLE_CHARS)}${year > 0 ? ` (${year})` : ''}\nSignals: ${reasons.join('; ')}`,
    },
  ];
}

/** Fixed, deterministic start-up check prompt. */
export const SMOKE_MESSAGES: ChatMessage[] = [
  { role: 'system', content: 'Reply with one short sentence.' },
  { role: 'user', content: 'Say that you are ready.' },
];

// ── Output checks ───────────────────────────────────────────────────────
//
// These verify FORMAT and usability only. They are not a semantic
// fact-check: a well-formed sentence can still be a poor or inaccurate one.

export const MAX_WORDS = 20;
export const MIN_WORDS = 3;
export const MAX_CHARS = 200;

const PREAMBLE =
  /^(?:(?:sure|certainly|of course|absolutely|okay|ok|here[\u2019']s|here is|here are|as an ai|sorry|unfortunately)\b|(?:explanation|answer|sentence)\s*:)/i;
const REFUSAL =
  /\b(?:as an ai|language model|i(?: cannot|[\u2019']m unable| am unable| can[\u2019']t| won[\u2019']t| am sorry|[\u2019']m sorry))\b/i;
const LIST_OR_MARKDOWN = /^(?:[-*\u2022]|\d+[.)])\s|\*\*|__|`|^#/;
const ABBREVIATIONS = new Set(['mr', 'mrs', 'ms', 'dr', 'st', 'jr', 'sr', 'vs', 'no', 'mt', 'ft']);

function hasSecondSentence(text: string): boolean {
  const boundary = /([.!?]+)["')\]]*\s+(?=\S)/g;
  let m: RegExpExecArray | null;
  while ((m = boundary.exec(text)) !== null) {
    if (m[1] === '.') {
      const word = (text.slice(0, m.index).split(/\s+/).pop() ?? '').toLowerCase().replace(/[^a-z]/g, '');
      // "Mr. Robot", "Dr. Strange", "J. K. Rowling" are not sentence ends.
      if (word.length === 1) continue;
      if (ABBREVIATIONS.has(word)) {
        // "No." is an abbreviation only before a number ("No. 5"); a
        // standalone "No." is a one-word answer, i.e. a sentence end.
        if (word === 'no' && !/\d/.test(text.charAt(m.index + m[0].length))) return true;
        continue;
      }
    }
    return true;
  }
  return false;
}

/**
 * Validates one explanation. Returns the cleaned sentence, or null when the
 * output is empty, malformed, too long, multi-line/multi-sentence, a list,
 * or an obvious preamble/refusal. Callers fall back to the rule-based
 * reasons on null.
 */
export function validateExplanation(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let text = raw.trim();
  if (text.length === 0 || /\n\s*\S/.test(text)) return null; // empty, or more than one line
  text = text.replace(/\s+/g, ' ');
  if (/^["\u201c]/.test(text) && /["\u201d]$/.test(text)) text = text.slice(1, -1).trim();
  if (text.length === 0 || text.length > MAX_CHARS) return null;
  if (!/[A-Za-z\u00c0-\u024f]/.test(text)) return null;
  if (PREAMBLE.test(text) || REFUSAL.test(text) || LIST_OR_MARKDOWN.test(text)) return null;
  const words = text.split(' ').filter(Boolean).length;
  if (words < MIN_WORDS || words > MAX_WORDS) return null;
  if (hasSecondSentence(text)) return null;
  return text;
}

/** The start-up check only needs "a short, usable response", not a good one. */
export function validateSmoke(raw: unknown): boolean {
  if (typeof raw !== 'string') return false;
  const text = raw.trim();
  return text.length > 0 && text.length <= MAX_CHARS && /[A-Za-z\u00c0-\u024f]/.test(text);
}
