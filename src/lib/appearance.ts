// src/lib/appearance.ts
//
// The single source of truth for how CineMatch looks. Mode (system / dark /
// light) and palette are separate preferences; fonts, text size, density,
// motion and effects are curated presets — there is no raw CSS, no remote
// font URL and no arbitrary script surface. Preferences are validated on
// every read, persisted under one versioned key, applied through whitelisted
// data-* attributes + CSS variables, and never stored with (or sent
// alongside) ratings, watchlists or any other personal movie data.
//
// src/lib/theme.ts is a thin facade over this module, so there is exactly
// one place that touches `data-theme`.

import { ensureFontLoaded, FONT_PRESETS, getFontPreset, type FontPresetId } from './fonts';
import { safeGet, safeSet } from './storage';

// ── Types & option lists ──────────────────────────────────────────────

export type Mode = 'system' | 'dark' | 'light';
export type PaletteId =
  | 'aurora'
  | 'noir-gold'
  | 'oceanic'
  | 'ember'
  | 'forest'
  | 'velvet-rose'
  | 'indie-paper'
  | 'monochrome';
export type MotionProfile = 'system' | 'full' | 'subtle' | 'off';
export type ParticleLevel = 'off' | 'subtle' | 'balanced' | 'interactive';

export interface AppearancePreferences {
  version: 1;
  mode: Mode;
  palette: PaletteId;
  fontPreset: FontPresetId;
  textScale: 90 | 100 | 110 | 125;
  lineSpacing: 'compact' | 'comfortable' | 'relaxed';
  contentWidth: 'compact' | 'comfortable' | 'wide';
  density: 'compact' | 'comfortable';
  posterSize: 'small' | 'medium' | 'large';
  cardShape: 'sharp' | 'standard' | 'rounded';
  surfaceStyle: 'solid' | 'glass';
  contrast: 'standard' | 'high';
  transparency: 'standard' | 'reduced';
  motion: MotionProfile;
  particles: ParticleLevel;
  /** Validated #rrggbb only. */
  customAccent?: string;
}

export interface PaletteInfo {
  id: PaletteId;
  label: string;
  mood: string;
  /** [dark bg, dark accent, dark accent 2, light bg, light accent, light accent 2] — preview swatches only. */
  swatch: [string, string, string, string, string, string];
}

export const PALETTES: PaletteInfo[] = [
  { id: 'aurora', label: 'Cinema Aurora', mood: 'Cinematic, atmospheric', swatch: ['#07050f', '#a78bfa', '#22d3ee', '#f7f3ee', '#7c5cf0', '#0b7d8f'] },
  { id: 'noir-gold', label: 'Noir & Gold', mood: 'Classic cinema, prestige', swatch: ['#0b0a08', '#d9b44a', '#efe3c0', '#f6f2e9', '#8a6414', '#5c4a1c'] },
  { id: 'oceanic', label: 'Oceanic', mood: 'Calm, modern, precise', swatch: ['#050d14', '#38bdf8', '#2dd4bf', '#edf5f8', '#0369a1', '#0f766e'] },
  { id: 'ember', label: 'Ember / Sunset', mood: 'Warm and expressive', swatch: ['#0f0709', '#fb7185', '#fbbf24', '#fbf2ec', '#c2410c', '#a16207'] },
  { id: 'forest', label: 'Forest / Jade', mood: 'Calm and natural', swatch: ['#050d09', '#34d399', '#a7f3d0', '#edf4ee', '#047857', '#15803d'] },
  { id: 'velvet-rose', label: 'Velvet Rose', mood: 'Stylish, dramatic', swatch: ['#0e0612', '#f472b6', '#c4b5fd', '#faf0f5', '#be185d', '#6d28d9'] },
  { id: 'indie-paper', label: 'Indie Paper', mood: 'Editorial film journal', swatch: ['#14100b', '#e08a5c', '#b5c273', '#f5efe0', '#a8481f', '#56601f'] },
  { id: 'monochrome', label: 'Monochrome / AMOLED', mood: 'Minimal, low distraction', swatch: ['#000000', '#ffffff', '#a3a3a3', '#ffffff', '#171717', '#404040'] },
];

export const DEFAULT_PREFERENCES: AppearancePreferences = {
  version: 1,
  mode: 'system',
  palette: 'aurora',
  fontPreset: 'default',
  textScale: 100,
  lineSpacing: 'comfortable',
  contentWidth: 'comfortable',
  density: 'comfortable',
  posterSize: 'medium',
  cardShape: 'rounded',
  surfaceStyle: 'solid',
  contrast: 'standard',
  transparency: 'standard',
  motion: 'system',
  particles: 'balanced',
};

const STORAGE_KEY = 'cinematch-appearance:v1';
const LEGACY_THEME_KEY = 'cinematch-theme';
const HISTORY_CAP = 20;

// ── Validation ────────────────────────────────────────────────────────

const oneOf = <T extends string | number>(v: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(v as T) ? (v as T) : fallback;

const HEX = /^#[0-9a-fA-F]{6}$/;

export function isValidHex(v: unknown): v is string {
  return typeof v === 'string' && HEX.test(v);
}

/** Rebuilds a preferences object field by field from untrusted input.
 * Unknown values fall back to defaults; an unknown future version is
 * rejected outright (returns defaults) rather than half-applied. */
export function sanitizePreferences(raw: unknown): AppearancePreferences {
  const d = DEFAULT_PREFERENCES;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ...d };
  const r = raw as Record<string, unknown>;
  if (r.version !== 1) return { ...d };
  const out: AppearancePreferences = {
    version: 1,
    mode: oneOf(r.mode, ['system', 'dark', 'light'] as const, d.mode),
    palette: oneOf(r.palette, PALETTES.map((p) => p.id), d.palette),
    fontPreset: oneOf(r.fontPreset, FONT_PRESETS.map((p) => p.id), d.fontPreset),
    textScale: oneOf(r.textScale, [90, 100, 110, 125] as const, d.textScale),
    lineSpacing: oneOf(r.lineSpacing, ['compact', 'comfortable', 'relaxed'] as const, d.lineSpacing),
    contentWidth: oneOf(r.contentWidth, ['compact', 'comfortable', 'wide'] as const, d.contentWidth),
    density: oneOf(r.density, ['compact', 'comfortable'] as const, d.density),
    posterSize: oneOf(r.posterSize, ['small', 'medium', 'large'] as const, d.posterSize),
    cardShape: oneOf(r.cardShape, ['sharp', 'standard', 'rounded'] as const, d.cardShape),
    surfaceStyle: oneOf(r.surfaceStyle, ['solid', 'glass'] as const, d.surfaceStyle),
    contrast: oneOf(r.contrast, ['standard', 'high'] as const, d.contrast),
    transparency: oneOf(r.transparency, ['standard', 'reduced'] as const, d.transparency),
    motion: oneOf(r.motion, ['system', 'full', 'subtle', 'off'] as const, d.motion),
    particles: oneOf(r.particles, ['off', 'subtle', 'balanced', 'interactive'] as const, d.particles),
  };
  if (isValidHex(r.customAccent)) out.customAccent = r.customAccent.toLowerCase();
  return out;
}

// ── Colour helpers (accent safety) ────────────────────────────────────

function luminance(hex: string): number {
  const h = hex.slice(1);
  const ch = [0, 2, 4].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const DARK_INK = '#0a0714';

/** The text colour that reads best on a given accent, plus whether even the
 * best choice clears WCAG AA (4.5:1) — the settings UI warns when it doesn't. */
export function accentForeground(accent: string): { color: string; ratio: number; ok: boolean } {
  const onDark = contrastRatio(DARK_INK, accent);
  const onWhite = contrastRatio('#ffffff', accent);
  const color = onDark >= onWhite ? DARK_INK : '#ffffff';
  const ratio = Math.max(onDark, onWhite);
  return { color, ratio, ok: ratio >= 4.5 };
}

// ── State ─────────────────────────────────────────────────────────────

type Listener = (prefs: AppearancePreferences) => void;

let prefs: AppearancePreferences = { ...DEFAULT_PREFERENCES };
let persisted = true; // false once a save fails (blocked storage)
let undoStack: AppearancePreferences[] = [];
let redoStack: AppearancePreferences[] = [];
let started = false;
let saveTimer: number | null = null;
const listeners = new Set<Listener>();
const mqDark = safeMatchMedia('(prefers-color-scheme: dark)');
const mqLight = safeMatchMedia('(prefers-color-scheme: light)');
const mqReduce = safeMatchMedia('(prefers-reduced-motion: reduce)');
const mqCoarse = safeMatchMedia('(pointer: coarse)');

function safeMatchMedia(q: string): MediaQueryList | null {
  try {
    return window.matchMedia(q);
  } catch {
    return null;
  }
}

function load(): AppearancePreferences {
  const raw = safeGet(STORAGE_KEY);
  if (raw) {
    try {
      return sanitizePreferences(JSON.parse(raw));
    } catch {
      return { ...DEFAULT_PREFERENCES };
    }
  }
  // First run of the new system: carry the old explicit light/dark choice
  // over once. The legacy key is never read again once new prefs exist.
  const legacy = safeGet(LEGACY_THEME_KEY);
  if (legacy === 'dark' || legacy === 'light') return { ...DEFAULT_PREFERENCES, mode: legacy };
  return { ...DEFAULT_PREFERENCES };
}

function save(immediate = false): void {
  const write = () => {
    saveTimer = null;
    persisted = safeSet(STORAGE_KEY, JSON.stringify(prefs));
    notify();
  };
  if (immediate) {
    if (saveTimer !== null) window.clearTimeout(saveTimer);
    write();
    return;
  }
  // Sliders and pickers fire continuously — preview instantly, persist once.
  if (saveTimer !== null) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(write, 350);
}

function notify(): void {
  for (const l of listeners) l(prefs);
}

// ── Effective (resolved) values ───────────────────────────────────────

export function effectiveMode(p: AppearancePreferences = prefs): 'dark' | 'light' {
  if (p.mode !== 'system') return p.mode;
  if (mqLight?.matches) return 'light';
  if (mqDark?.matches) return 'dark';
  return 'dark';
}

export function systemRequestsReducedMotion(): boolean {
  return mqReduce?.matches ?? false;
}

/** System behaves like Subtle, except non-essential continuous/large
 * movement is off when the OS asks for reduced motion. */
export function effectiveMotion(p: AppearancePreferences = prefs): 'full' | 'subtle' | 'off' {
  if (p.motion === 'system') return systemRequestsReducedMotion() ? 'off' : 'subtle';
  return p.motion;
}

const LEVELS: ParticleLevel[] = ['off', 'subtle', 'balanced', 'interactive'];

function isLowPower(): boolean {
  const cores = navigator.hardwareConcurrency || 4;
  const mobile = /Android|iPhone|iPad|iPod|Mobi/i.test(navigator.userAgent);
  return mobile || cores <= 2;
}

/** The hero particle level actually used. A user-selected Off always wins;
 * otherwise the level adapts *downward* on touch and low-power devices. */
export function effectiveParticles(p: AppearancePreferences = prefs): ParticleLevel {
  if (p.particles === 'off' || effectiveMotion(p) === 'off') return 'off';
  let level = LEVELS.indexOf(p.particles);
  if (mqCoarse?.matches) level = Math.min(level, LEVELS.indexOf('balanced')); // no pointer response without a hover pointer
  if (isLowPower()) level = Math.min(level, LEVELS.indexOf('subtle'));
  return LEVELS[level]!;
}

export function getPreferences(): AppearancePreferences {
  return prefs;
}

/** False when storage is blocked: the UI must not claim a save happened. */
export function isAppearancePersisted(): boolean {
  return persisted;
}

// ── Applying to the document ──────────────────────────────────────────

const LINE_HEIGHT = { compact: 1.45, comfortable: 1.6, relaxed: 1.8 } as const;

export function applyPreferences(p: AppearancePreferences = prefs): void {
  const root = document.documentElement;
  const mode = effectiveMode(p);
  root.setAttribute('data-theme', mode);
  root.setAttribute('data-palette', p.palette);
  root.setAttribute('data-font', p.fontPreset);
  root.setAttribute('data-density', p.density);
  root.setAttribute('data-width', p.contentWidth);
  root.setAttribute('data-shape', p.cardShape);
  root.setAttribute('data-poster', p.posterSize);
  root.setAttribute('data-surface', p.surfaceStyle);
  root.setAttribute('data-contrast', p.contrast);
  root.setAttribute('data-transparency', p.transparency);
  root.setAttribute('data-motion', effectiveMotion(p));
  root.style.colorScheme = mode;

  const preset = getFontPreset(p.fontPreset);
  root.style.setProperty('--font-display', preset.display);
  root.style.setProperty('--font-body', preset.body);
  root.style.setProperty('--font-mono', preset.mono);
  root.style.setProperty('--heading-weight', String(preset.headingWeight));
  root.style.setProperty('--text-scale', String(p.textScale / 100));
  root.style.setProperty('--line-body', String(LINE_HEIGHT[p.lineSpacing]));
  void ensureFontLoaded(p.fontPreset);

  if (p.customAccent && isValidHex(p.customAccent)) {
    root.setAttribute('data-accent', 'custom');
    root.style.setProperty('--user-accent', p.customAccent);
    root.style.setProperty('--user-on-accent', accentForeground(p.customAccent).color);
  } else {
    root.removeAttribute('data-accent');
    root.style.removeProperty('--user-accent');
    root.style.removeProperty('--user-on-accent');
  }

  syncBrowserChrome(root);
}

/** Keeps the browser UI colour, form controls and the pre-paint boot
 * background in step with the palette that is actually showing. */
function syncBrowserChrome(root: HTMLElement): void {
  const bg = getComputedStyle(root).getPropertyValue('--bg-0').trim();
  if (!bg) return;
  document.querySelectorAll('meta[name="theme-color"]').forEach((m, i) => {
    if (i > 0) m.remove(); // the media-split pair from index.html is replaced by one live tag
  });
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.removeAttribute('media');
    meta.setAttribute('content', bg);
  }
  root.style.setProperty('--boot-bg', bg);
}

// ── Public mutations ──────────────────────────────────────────────────

function commit(next: AppearancePreferences, opts: { history?: boolean; immediate?: boolean } = {}): void {
  if (JSON.stringify(next) === JSON.stringify(prefs)) return;
  if (opts.history !== false) {
    undoStack.push(prefs);
    if (undoStack.length > HISTORY_CAP) undoStack.shift();
    redoStack = [];
  }
  prefs = next;
  applyPreferences(prefs);
  save(opts.immediate ?? false);
  notify();
}

/** Merges a validated patch; preview is instant, persistence is debounced. */
export function updatePreferences(patch: Partial<Omit<AppearancePreferences, 'version'>>, opts: { history?: boolean; immediate?: boolean } = {}): void {
  const merged = sanitizePreferences({ ...prefs, ...patch, version: 1 });
  // sanitize drops an invalid customAccent, but an explicit `undefined`
  // in the patch must also clear a previously valid one.
  if ('customAccent' in patch && patch.customAccent === undefined) delete merged.customAccent;
  commit(merged, opts);
}

export type ResetSection = 'themes' | 'typography' | 'layout' | 'motion' | 'accessibility';

const SECTION_KEYS: Record<ResetSection, (keyof AppearancePreferences)[]> = {
  themes: ['mode', 'palette', 'customAccent'],
  typography: ['fontPreset', 'textScale', 'lineSpacing'],
  layout: ['contentWidth', 'density', 'posterSize', 'cardShape', 'surfaceStyle'],
  motion: ['motion', 'particles'],
  accessibility: ['contrast', 'transparency'],
};

export function resetSection(section: ResetSection): void {
  const next: AppearancePreferences = { ...prefs };
  for (const key of SECTION_KEYS[section]) {
    if (key === 'customAccent') delete next.customAccent;
    else (next as unknown as Record<string, unknown>)[key] = DEFAULT_PREFERENCES[key];
  }
  commit(sanitizePreferences(next), { immediate: true });
}

/** Appearance only — never touches ratings, watchlist, profile or quiz state. */
export function resetAllAppearance(): void {
  commit({ ...DEFAULT_PREFERENCES }, { immediate: true });
}

export function canUndo(): boolean {
  return undoStack.length > 0;
}
export function canRedo(): boolean {
  return redoStack.length > 0;
}

export function undo(): void {
  const prev = undoStack.pop();
  if (!prev) return;
  redoStack.push(prefs);
  prefs = prev;
  applyPreferences(prefs);
  save(true);
  notify();
}

export function redo(): void {
  const next = redoStack.pop();
  if (!next) return;
  undoStack.push(prefs);
  prefs = next;
  applyPreferences(prefs);
  save(true);
  notify();
}

/** Curated random look: palette + (sometimes) a font preset. Never touches
 * semantic colours, accessibility or motion settings. */
export function randomizePalette(): void {
  const others = PALETTES.filter((p) => p.id !== prefs.palette);
  const palette = others[Math.floor(Math.random() * others.length)]!.id;
  const fonts = FONT_PRESETS.filter((f) => f.id !== 'system');
  const fontPreset = fonts[Math.floor(Math.random() * fonts.length)]!.id;
  commit(sanitizePreferences({ ...prefs, palette, fontPreset, customAccent: undefined }), { immediate: true });
}

/** Quick header toggle: flips what is *currently showing* to an explicit
 * Light/Dark, so the choice stops following the OS afterwards. */
export function toggleQuickMode(): 'dark' | 'light' {
  const next = effectiveMode() === 'dark' ? 'light' : 'dark';
  updatePreferences({ mode: next }, { immediate: true });
  return next;
}

export function subscribeAppearance(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// ── Startup ───────────────────────────────────────────────────────────

/** Call once, before the first app content is mounted. */
export function initAppearance(): void {
  if (started) return;
  started = true;
  prefs = load();
  applyPreferences(prefs);

  // Live OS changes: System mode follows colour scheme; System motion
  // follows reduced-motion. Explicit choices are never overridden.
  const onSystemChange = () => {
    applyPreferences(prefs);
    notify();
  };
  for (const mq of [mqDark, mqLight, mqReduce, mqCoarse]) {
    if (!mq) continue;
    if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onSystemChange);
    else (mq as MediaQueryList).addListener?.(onSystemChange);
  }
}

// ── "Choose your vibe" (one-time, skippable) ──────────────────────────

const VIBE_KEY = 'cinematch-vibe:v1';

export interface Vibe {
  id: 'cinematic' | 'minimal' | 'editorial' | 'neon';
  label: string;
  blurb: string;
  patch: Partial<AppearancePreferences>;
}

export const VIBES: Vibe[] = [
  { id: 'cinematic', label: 'Cinematic', blurb: 'Aurora, subtle motion, balanced particles.', patch: { palette: 'aurora', fontPreset: 'default', motion: 'subtle', particles: 'balanced' } },
  { id: 'minimal', label: 'Minimal', blurb: 'Monochrome, system font, calm.', patch: { palette: 'monochrome', fontPreset: 'system', motion: 'subtle', particles: 'off', surfaceStyle: 'solid' } },
  { id: 'editorial', label: 'Editorial', blurb: 'Paper tones, serif headings, quiet motion.', patch: { palette: 'indie-paper', fontPreset: 'prestige-cinema', motion: 'subtle', particles: 'subtle' } },
  { id: 'neon', label: 'Neon', blurb: 'Aurora with interactive particles.', patch: { palette: 'aurora', fontPreset: 'modern-grotesk', motion: 'full', particles: 'interactive' } },
];

export function vibeAlreadyHandled(): boolean {
  return safeGet(VIBE_KEY) !== null;
}

export function markVibeHandled(choice: string): void {
  safeSet(VIBE_KEY, choice);
}

/** Applies a vibe as ordinary preferences. Accessibility wins: an OS
 * reduced-motion request still keeps System-resolved motion off unless the
 * person later chooses otherwise, so vibes never force motion on. */
export function applyVibe(id: Vibe['id']): void {
  const vibe = VIBES.find((v) => v.id === id);
  if (!vibe) return;
  const patch = { ...vibe.patch };
  if (systemRequestsReducedMotion()) delete patch.motion;
  updatePreferences(patch, { immediate: true });
  markVibeHandled(id);
}
