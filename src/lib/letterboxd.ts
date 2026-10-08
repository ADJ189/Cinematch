// src/lib/letterboxd.ts
//
// Import a Letterboxd "ratings.csv" export (Settings → Data → Export) as a
// taste-calibration shortcut, so returning users don't have to re-rate
// titles by hand. Parsing only — no network calls, no dependency.

export interface LetterboxdRow {
  title: string;
  year: number;
  /** 1-5, rounded — what the 5-star UI shows. */
  rating: number;
  /** The exact 0.5-5 value from the export; half-star precision is kept
   * so a 3.5 and a 4 don't collapse into the same taste signal. */
  stars: number;
}

export function parseLetterboxdCsv(csvText: string): LetterboxdRow[] {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const header = splitCsvLine(lines[0] ?? '');
  const nameIdx = header.indexOf('Name');
  const yearIdx = header.indexOf('Year');
  const ratingIdx = header.indexOf('Rating');
  if (nameIdx === -1 || ratingIdx === -1) return [];

  const rows: LetterboxdRow[] = [];
  for (const line of lines.slice(1)) {
    const cols = splitCsvLine(line);
    const title = cols[nameIdx]?.trim();
    const rawRating = cols[ratingIdx]?.trim();
    if (!title || !rawRating) continue;

    const stars = Number(rawRating);
    if (Number.isNaN(stars) || stars <= 0) continue;

    rows.push({
      title,
      year: yearIdx !== -1 ? Number(cols[yearIdx]) || 0 : 0,
      rating: Math.max(1, Math.min(5, Math.round(stars))),
      stars: Math.max(0.5, Math.min(5, stars)),
    });
  }
  return rows;
}

// Minimal RFC4180-ish CSV split: handles quoted fields containing commas.
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}
