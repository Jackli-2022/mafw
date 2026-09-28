/**
 * R5 FOK gate (PFC meta-memory monitor).
 *
 * Brain basis: mPFC damage → confident confabulation (Schnyer 2004); the
 * feeling-of-knowing signal must be read from retrieval's own score
 * distribution — LLM self-reported confidence is useless (arXiv:2605.24299)
 * and prompt-level abstention collapses under misleading context
 * (arXiv:2608.22228).
 *
 * Measurement basis (LongMemEval-S 120q AUROC pre-check, 2026-09-27):
 * the scale-free `top1/mean` ratio discriminates "answer in top-k" at
 * AUROC ≈ 0.85–0.88 (bm25) / 0.95–1.0 (hybrid); top1−top2 margin and
 * ratio-of-pairs are weak (< 0.66). Features MUST be computed from raw
 * relevance scores, never energy×salience-weighted ones.
 */

export interface FokFeatures {
  /** Best raw relevance score among candidates. */
  top1: number;
  /** Mean raw relevance score across candidates. */
  mean: number;
  /** Scale-free dominance of the best candidate (top1 / mean); 0 when mean ≤ 0. */
  top1OverMean: number;
  count: number;
}

export type FokZone = 'inject' | 'low-confidence' | 'no-memory';

export interface FokThresholds {
  /** top1OverMean ≥ high → inject as a normal pointer. */
  high: number;
  /** top1OverMean ≥ low (and < high) → inject with an uncertainty marker. */
  low: number;
}

export interface FokFitSample {
  feature: number;
  hit: boolean;
}

export interface FokFitOptions {
  /** Target precision for the confident (inject) zone. Default 0.9. */
  highPrecision?: number;
  /** Minimum true positives required before a high threshold is accepted. Default 3. */
  minPositive?: number;
}

/** Score-distribution features. `scores` may be in any order; top1 is the max. */
export function computeFokFeatures(scores: number[]): FokFeatures {
  const count = scores.length;
  if (count === 0) return { top1: 0, mean: 0, top1OverMean: 0, count: 0 };
  let sum = 0;
  let top1 = -Infinity;
  for (const s of scores) {
    sum += s;
    if (s > top1) top1 = s;
  }
  const mean = sum / count;
  return { top1, mean, top1OverMean: mean > 0 ? top1 / mean : 0, count };
}

/**
 * Three-zone decision. Asymmetric by design: only a clearly dominant top-1
 * gets the normal treatment; a flat distribution yields an explicit
 * "no reliable memory" — silence is the one option that is never correct
 * (it invites confabulation).
 */
export function classifyFok(f: FokFeatures, th: FokThresholds): FokZone {
  if (f.count === 0) return 'no-memory';
  if (f.top1OverMean >= th.high) return 'inject';
  if (f.top1OverMean >= th.low) return 'low-confidence';
  return 'no-memory';
}

/**
 * Offline threshold fitting from labelled runs (feature value + "answer was in
 * top-k"). `low` maximises balanced accuracy (inject vs no-memory); `high` is
 * the lowest threshold meeting the precision target. Returns null when the
 * sample set cannot separate (empty, or all-hit / all-miss) — callers keep
 * their config defaults in that case.
 */
export function fitFokThresholds(
  samples: FokFitSample[],
  opts: FokFitOptions = {},
): FokThresholds | null {
  const highPrecision = opts.highPrecision ?? 0.9;
  const minPositive = opts.minPositive ?? 3;
  const positives = samples.filter(s => s.hit).length;
  const negatives = samples.length - positives;
  if (samples.length === 0 || positives === 0 || negatives === 0) return null;

  const unique = [...new Set(samples.map(s => s.feature))].sort((a, b) => a - b);
  if (unique.length < 2) return null;
  const candidates = unique.slice(0, -1).map((v, i) => (v + unique[i + 1]) / 2);

  const statsAt = (t: number) => {
    let tp = 0, fp = 0, fn = 0, tn = 0;
    for (const s of samples) {
      const predicted = s.feature >= t;
      if (predicted && s.hit) tp++;
      else if (predicted && !s.hit) fp++;
      else if (!predicted && s.hit) fn++;
      else tn++;
    }
    const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
    const specificity = tn + fp > 0 ? tn / (tn + fp) : 0;
    return { tp, precision, balAcc: 0.5 * (recall + specificity) };
  };

  let best = candidates[0];
  let bestBal = -Infinity;
  for (const t of candidates) {
    const st = statsAt(t);
    if (st.balAcc > bestBal) { bestBal = st.balAcc; best = t; }
  }

  let high: number | null = null;
  for (const t of candidates) {
    const st = statsAt(t);
    if (st.precision >= highPrecision && st.tp >= minPositive) { high = t; break; }
  }

  const low = best;
  return { low, high: high !== null && high >= low ? high : low };
}
