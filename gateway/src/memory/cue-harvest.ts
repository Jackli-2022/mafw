/**
 * Write-side fidelity (R7 pre-check follow-up, 2026-09-28).
 *
 * Search only reads `primary_abstraction` + `cue_anchors`, but 2270/3722 stored
 * memories carried identifier-like cues (camelCase, snake_case, paths, kebab
 * filenames) only in their BODY — unreachable by any query, no matter how the
 * tokenizer behaves. This harvests those tokens into cue_anchors at write time.
 *
 * Purely additive and bounded (never removes an anchor, never rewrites the
 * body). Prose rarely matches these patterns (camelCase needs an interior
 * capital, snake_case/paths need punctuation), so ordinary text is unaffected.
 */

export interface HarvestOptions {
  /** Max tokens to add (default 6). */
  max?: number;
  /** Minimum token length (default 5). */
  minLen?: number;
}

const PATTERNS: RegExp[] = [
  /\b[a-z][A-Za-z0-9]*[A-Z][A-Za-z0-9]*\b/g,       // camelCase / PascalCase-ish
  /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g,            // snake_case
  /\b[\w.-]+\/[\w./-]{2,}\b/g,                     // path-like (src/foo/bar.ts)
  /\b[a-z0-9]+(?:-[a-z0-9]+)+\.[a-z]{2,4}\b/g,     // kebab filename.css
];

/** Returns identifier-like cues from `text` not already present in `existing`. */
export function harvestIdentifierCues(
  text: string,
  existing: string[] = [],
  options: HarvestOptions = {},
): string[] {
  const max = options.max ?? 6;
  const minLen = options.minLen ?? 5;
  if (!text || max <= 0) return [];
  const seen = new Set(existing.map(e => e.toLowerCase()));
  const out: string[] = [];
  for (const re of PATTERNS) {
    for (const match of text.match(re) ?? []) {
      const token = match.trim();
      if (token.length < minLen) continue;
      const key = token.toLowerCase();
      if (seen.has(key)) continue;
      if (/^https?$/i.test(token)) continue;
      seen.add(key);
      out.push(token);
      if (out.length >= max) return out;
    }
  }
  return out;
}
