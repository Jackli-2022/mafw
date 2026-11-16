// Calibration for embedding-derived T1 atoms.
//
// Sentence embeddings are anisotropic: unrelated text still scores ~0.34–0.38
// against every concept anchor on the local Qwen3 model. A raw cosine cutoff
// therefore keeps most of the dictionary. We remove two backgrounds:
//   1. per-anchor baseline — how strongly this anchor fires on arbitrary text;
//   2. per-text mean — the text's own overall affinity to the dictionary.
// Only atoms that stand out from both survive.
import type { T1SparseAtom } from './t1-sparse';

export interface SelectAtomOptions {
  /** Maximum atoms per text (default 2). */
  topK?: number;
  /** Minimum centered score for an atom (default 0.02). */
  minScore?: number;
  /** Minimum centered score for the best atom; below this the text abstains (default 0.05). */
  minTop1?: number;
}

/** Cosine similarity; 0 for empty or mismatched vectors. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a?.length || !b?.length || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Mean cosine between each anchor and a reference population of texts. */
export function computeAnchorBaselines(
  anchorVectors: number[][],
  referenceVectors: number[][],
): number[] {
  return anchorVectors.map((anchor) => {
    if (referenceVectors.length === 0) return 0;
    let sum = 0;
    for (const reference of referenceVectors) {
      sum += cosineSimilarity(reference, anchor);
    }
    return sum / referenceVectors.length;
  });
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

/**
 * Select the atoms that stand out for one text.
 *
 * `score_k = (cos_k - baseline_k) - mean_j(cos_j - baseline_j)`.
 * Returns [] when the best centered score is below `minTop1`, so an
 * out-of-domain text abstains instead of being forced onto the nearest concept.
 */
export function selectCalibratedAtoms(
  raw: Array<{ termId: string; cosine: number }>,
  baselines: number[],
  opts: SelectAtomOptions = {},
): T1SparseAtom[] {
  if (raw.length === 0) return [];
  const topK = Math.max(1, Math.trunc(opts.topK ?? 2));
  const minScore = opts.minScore ?? 0.02;
  const minTop1 = opts.minTop1 ?? 0.05;

  const shifted = raw.map((atom, index) => ({
    termId: atom.termId,
    score: atom.cosine - (baselines[index] ?? 0),
  }));
  const mean = shifted.reduce((sum, atom) => sum + atom.score, 0) / shifted.length;
  const scored = shifted
    .map((atom) => ({ termId: atom.termId, score: round6(atom.score - mean) }))
    .filter((atom) => Number.isFinite(atom.score) && atom.score >= minScore)
    .sort((a, b) => b.score - a.score || a.termId.localeCompare(b.termId));

  if (scored.length === 0 || scored[0].score < minTop1) return [];
  return scored.slice(0, topK);
}
