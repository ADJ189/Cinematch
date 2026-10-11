// src/lib/artwork.ts
//
// Artwork-aware ambience: pulls two soft accent colours out of a poster so
// the featured pick can have a gentle, *confined* halo. Rules this module
// keeps on purpose:
//
//  • The colours only ever feed low-opacity decorative gradients/shadows
//    around the featured card — never body text, controls, alerts or the
//    global theme tokens.
//  • Extraction happens only after the poster has loaded, on a tiny canvas
//    (24×24), and is cached by `mediaKey|url`. Nothing is kept alive after.
//  • TMDB images are cross-origin: canvas readback can fail (CORS/taint).
//    That is expected — every failure path resolves to `null`, and the
//    caller shows the deterministic palette-token halo instead. It can never
//    break the screen.

const cache = new Map<string, [string, string] | null>();
const CACHE_MAX = 60;

function toHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

/** Two dominant, distinct, reasonably saturated hues — or null. */
export function paletteFromPixels(data: Uint8ClampedArray): [string, string] | null {
  const BUCKETS = 12;
  const acc = Array.from({ length: BUCKETS }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]!;
    if (a < 200) continue;
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    const [h, s, l] = rgbToHsl(r, g, b);
    if (s < 0.28 || l < 0.18 || l > 0.82) continue; // skip greys, near-black and near-white
    const w = s * (1 - Math.abs(l - 0.5));
    const bucket = acc[Math.floor(h / (360 / BUCKETS)) % BUCKETS]!;
    bucket.w += w;
    bucket.r += r * w;
    bucket.g += g * w;
    bucket.b += b * w;
  }
  const ranked = acc.map((v, i) => ({ ...v, i })).filter((v) => v.w > 0).sort((a, b) => b.w - a.w);
  if (ranked.length === 0) return null;
  const first = ranked[0]!;
  const second = ranked.find((v) => Math.min(Math.abs(v.i - first.i), BUCKETS - Math.abs(v.i - first.i)) >= 2) ?? first;
  const hex = (v: (typeof ranked)[number]) => toHex(v.r / v.w, v.g / v.w, v.b / v.w);
  return [hex(first), hex(second)];
}

/** Resolves to a palette, or null on any failure. Never rejects. */
export function extractArtworkPalette(key: string, url: string | null): Promise<[string, string] | null> {
  if (!url) return Promise.resolve(null);
  const cacheKey = `${key}|${url}`;
  if (cache.has(cacheKey)) return Promise.resolve(cache.get(cacheKey)!);

  return new Promise((resolve) => {
    const finish = (value: [string, string] | null) => {
      if (cache.size >= CACHE_MAX) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
      }
      cache.set(cacheKey, value);
      resolve(value);
    };
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.decoding = 'async';
      const timer = window.setTimeout(() => {
        img.src = '';
        finish(null);
      }, 6000);
      img.onload = () => {
        window.clearTimeout(timer);
        try {
          const size = 24;
          const canvas = document.createElement('canvas');
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (!ctx) return finish(null);
          ctx.drawImage(img, 0, 0, size, size);
          finish(paletteFromPixels(ctx.getImageData(0, 0, size, size).data));
        } catch {
          finish(null); // tainted canvas / blocked readback
        }
      };
      img.onerror = () => {
        window.clearTimeout(timer);
        finish(null);
      };
      img.src = url;
    } catch {
      finish(null);
    }
  });
}
