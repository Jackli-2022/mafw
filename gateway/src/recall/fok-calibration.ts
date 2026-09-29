// A4: offline calibration for the FOK three-zone gate. Replaces fixed
// probLow/probHigh with an isotonic fit of P(hit | top1prob) over production
// FOK logs (or the LongMemEval abstention seeds). Know-Before-You-Fetch
// (arXiv:2606.29959): calibrate BEFORE thresholding; out-of-fold mandatory.
// Conformal abstention (arXiv:2405.01563): a few hundred calibration points
// already give finite-sample guarantees — no need to wait for big logs.

export interface FokSample {
  top1prob: number;
  hit: boolean;
}

interface Block {
  /** x-range this block covers (inclusive). */
  lo: number;
  hi: number;
  /** fitted rate for the block (weighted mean of hits). */
  y: number;
  w: number;
}

export interface IsotonicFit {
  fit(p: number): number;
  ece: number;
  n: number;
}

/** Pool-Adjacent-Violators isotonic regression of P(hit | top1prob). */
export function fitIsotonic(samples: FokSample[]): IsotonicFit {
  const valid = samples
    .filter((s) => s && Number.isFinite(s.top1prob))
    .sort((a, b) => a.top1prob - b.top1prob);
  if (valid.length === 0) {
    return { fit: () => 0.5, ece: 0, n: 0 };
  }

  // PAVA: blocks in x order, merged while monotonicity is violated.
  const blocks: Block[] = [];
  for (const s of valid) {
    const next: Block = { lo: s.top1prob, hi: s.top1prob, y: s.hit ? 1 : 0, w: 1 };
    blocks.push(next);
    while (
      blocks.length > 1 &&
      blocks[blocks.length - 2].y > blocks[blocks.length - 1].y
    ) {
      const r = blocks.pop()!;
      const l = blocks.pop()!;
      const w = l.w + r.w;
      blocks.push({ lo: l.lo, hi: r.hi, y: (l.y * l.w + r.y * r.w) / w, w });
    }
  }

  const fit = (p: number): number => {
    const x = Math.max(blocks[0].lo, Math.min(blocks[blocks.length - 1].hi, p));
    // first block whose upper bound covers x (blocks are ordered by x)
    let lo = 0;
    let hi = blocks.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (blocks[mid].hi < x) lo = mid + 1;
      else hi = mid;
    }
    return blocks[lo].y;
  };

  // ECE over 10 equal-width bins (binned actual rate vs isotonic prediction).
  let ece = 0;
  const B = 10;
  for (let b = 0; b < B; b++) {
    const lo = b / B;
    const hi = (b + 1) / B;
    const inBin = valid.filter((s) => s.top1prob >= lo && s.top1prob < hi);
    if (inBin.length === 0) continue;
    const actual = inBin.reduce((acc, s) => acc + (s.hit ? 1 : 0), 0) / inBin.length;
    const predicted = inBin.reduce((acc, s) => acc + fit(s.top1prob), 0) / inBin.length;
    ece += (inBin.length / valid.length) * Math.abs(actual - predicted);
  }

  return { fit, ece, n: valid.length };
}

/**
 * Operating point for the three-zone gate: probLow = smallest p whose fitted
 * hit-rate crosses noMemoryRate (below it the gate declares "no reliable
 * memory"); probHigh = smallest p crossing lowConfRate (above it, inject).
 * Scan granularity 0.02.
 */
export function pickThresholds(
  fit: (p: number) => number,
  opts: { noMemoryRate?: number; lowConfRate?: number } = {},
): { probLow: number; probHigh: number } {
  const noMemoryRate = opts.noMemoryRate ?? 0.2;
  const lowConfRate = opts.lowConfRate ?? 0.6;
  const find = (target: number): number => {
    for (let p = 0.02; p <= 1.0001; p += 0.02) {
      if (fit(p) >= target) return Math.round(p * 100) / 100;
    }
    return 1;
  };
  const probLow = find(noMemoryRate);
  return { probLow, probHigh: Math.max(probLow, find(lowConfRate)) };
}
