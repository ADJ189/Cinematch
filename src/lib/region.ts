// src/lib/region.ts — which country's streaming availability to show.
//
// TMDB's /watch/providers (JustWatch data underneath) returns a different
// answer per region because of real licensing differences — the same
// title can be on one service in one country and unavailable, or on a
// different service entirely, in another. tmdb.ts used to guess this
// once from the browser's locale and never let the user change it, which
// breaks for anyone whose OS/browser language doesn't match where they
// actually subscribe (a US Netflix account with the OS set to en-GB, a
// traveler checking what's available at home, someone who just prefers
// a different language locale than their country). This module makes
// that pick explicit and overridable, persisted the same way theme.ts
// persists dark/light: a plain localStorage string, read fresh each call
// so it stays in sync with whatever the region selector last set.

export interface RegionOption {
  code: string;
  name: string;
}

// TMDB/JustWatch supports many more territories than this, but the full
// list is >100 entries of long-tail coverage; this is the set of markets
// JustWatch has substantial catalog data for. "More on TMDB" isn't
// offered here — the region only controls which provider list we render,
// and a wrong-but-close guess (e.g. defaulting to US) is more useful than
// a 100-entry dropdown for a feature most people will never open.
export const REGIONS: RegionOption[] = [
  { code: 'US', name: 'United States' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'CA', name: 'Canada' },
  { code: 'AU', name: 'Australia' },
  { code: 'NZ', name: 'New Zealand' },
  { code: 'IE', name: 'Ireland' },
  { code: 'IN', name: 'India' },
  { code: 'DE', name: 'Germany' },
  { code: 'FR', name: 'France' },
  { code: 'ES', name: 'Spain' },
  { code: 'IT', name: 'Italy' },
  { code: 'PT', name: 'Portugal' },
  { code: 'NL', name: 'Netherlands' },
  { code: 'BE', name: 'Belgium' },
  { code: 'CH', name: 'Switzerland' },
  { code: 'AT', name: 'Austria' },
  { code: 'SE', name: 'Sweden' },
  { code: 'NO', name: 'Norway' },
  { code: 'DK', name: 'Denmark' },
  { code: 'FI', name: 'Finland' },
  { code: 'PL', name: 'Poland' },
  { code: 'CZ', name: 'Czech Republic' },
  { code: 'GR', name: 'Greece' },
  { code: 'TR', name: 'Turkey' },
  { code: 'RU', name: 'Russia' },
  { code: 'UA', name: 'Ukraine' },
  { code: 'ZA', name: 'South Africa' },
  { code: 'NG', name: 'Nigeria' },
  { code: 'EG', name: 'Egypt' },
  { code: 'AE', name: 'United Arab Emirates' },
  { code: 'SA', name: 'Saudi Arabia' },
  { code: 'IL', name: 'Israel' },
  { code: 'JP', name: 'Japan' },
  { code: 'KR', name: 'South Korea' },
  { code: 'CN', name: 'China' },
  { code: 'HK', name: 'Hong Kong' },
  { code: 'TW', name: 'Taiwan' },
  { code: 'SG', name: 'Singapore' },
  { code: 'MY', name: 'Malaysia' },
  { code: 'TH', name: 'Thailand' },
  { code: 'ID', name: 'Indonesia' },
  { code: 'PH', name: 'Philippines' },
  { code: 'VN', name: 'Vietnam' },
  { code: 'PK', name: 'Pakistan' },
  { code: 'BR', name: 'Brazil' },
  { code: 'MX', name: 'Mexico' },
  { code: 'AR', name: 'Argentina' },
  { code: 'CL', name: 'Chile' },
  { code: 'CO', name: 'Colombia' },
  { code: 'PE', name: 'Peru' },
];

const STORAGE_KEY = 'cinematch-region';

/** Best-effort guess from the browser's locale (e.g. "en-GB" → "GB").
 * Falls back to US, the largest single JustWatch dataset, when the
 * locale carries no usable country subtag. */
export function guessBrowserRegion(): string {
  try {
    const locale = navigator.languages?.[0] ?? navigator.language;
    const region = locale.split('-')[1]?.toUpperCase();
    return region && region.length === 2 ? region : 'US';
  } catch {
    return 'US';
  }
}

/** The region actually used for provider lookups: a manually-picked
 * override if one is stored, else the browser-locale guess. Always
 * returns a valid 2-letter code — never assume localStorage works. */
export function getRegion(): string {
  return getRegionOverride() ?? guessBrowserRegion();
}

/** Just the explicit override, or null if the user hasn't picked one
 * (i.e. still on the auto-detected region). Used by the region selector
 * to show "Auto-detected" vs a specific chosen country. */
export function getRegionOverride(): string | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored && REGIONS.some((r) => r.code === stored) ? stored : null;
  } catch {
    return null;
  }
}

/** Pass null to clear the override and go back to auto-detecting. */
export function setRegion(code: string | null): void {
  try {
    if (code) localStorage.setItem(STORAGE_KEY, code);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage blocked (private mode, etc.) — the pick just won't survive
    // a reload this session, same degradation as profile.ts and theme.ts.
  }
}

export function regionName(code: string): string {
  return REGIONS.find((r) => r.code === code)?.name ?? code;
}
