// V2 ②: TCM-style running-vector boundary detection (pure). Adjacent-turn
// cosine below threshold = event boundary ("splitter-is-the-indexer": the
// sealed segment vector doubles as the segment retrieval key). Tier0
// structural signals force boundaries. Shadow mode only in V2 — the hourly
// batch trigger is untouched until the shadow log proves boundary quality.

export interface SegmentationOpts { alpha?: number; cosineThreshold?: number }

function tokensOf(text: string): string[] {
  const raw = text.toLowerCase();
  return [...(raw.match(/[a-z0-9_]{2,}/g) ?? []), ...(raw.match(/[\u4e00-\u9fff]/g) ?? [])];
}

function unit(vec: Map<number, number>): Map<number, number> {
  let n = 0;
  for (const v of vec.values()) n += v * v;
  n = Math.sqrt(n) || 1;
  const out = new Map<number, number>();
  for (const [k, v] of vec) out.set(k, v / n);
  return out;
}

/** TCM-style running vector over UNIT-normalized items: mixing on the unit
 * sphere keeps the drift signal scale-stable across turn lengths. */
export function runningVector(
  prev: Map<number, number> | null,
  tokenIds: number[],
  alpha: number,
): Map<number, number> {
  const curCounts = new Map<number, number>();
  for (const id of tokenIds) curCounts.set(id, (curCounts.get(id) ?? 0) + 1);
  const cur = unit(curCounts);
  const out = new Map<number, number>();
  if (prev) for (const [k, v] of prev) out.set(k, v * (1 - alpha));
  for (const [k, v] of cur) out.set(k, (out.get(k) ?? 0) + v * alpha);
  return out;
}

function cosineSparse(a: Map<number, number>, b: Map<number, number>): number {
  let dot = 0, na = 0, nb = 0;
  for (const [, v] of a) na += v * v;
  for (const [, v] of b) nb += v * v;
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  for (const [k, v] of small) {
    const w = big.get(k);
    if (w) dot += v * w;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-9);
}

export interface Segment<T> {
  items: T[];
  boundaryBefore: boolean;
  /** Sealed running vector at segment end — the segment retrieval key. */
  sealedVector?: Map<number, number>;
}

/** Boundary = CURRENT item dissimilar to the accumulated context (TCM drift
 * semantics; running-vs-running is too weak — an orthogonal shift only
 * drops the cosine to ~(1-α)). Threshold 0.2: same-topic unit cosine lands
 * ~0.3-0.6, topic switch ~0.05. Shadow-mode heuristic — calibrate from the
 * shadow log before going live. */
export function segmentTurns<T extends { text: string; structuralBreak?: boolean }>(
  turns: T[],
  opts?: SegmentationOpts,
): Segment<T>[] {
  const alpha = opts?.alpha ?? 0.3;
  const threshold = opts?.cosineThreshold ?? 0.2;
  const vocab = new Map<string, number>();
  const idOf = (t: string) => {
    let id = vocab.get(t);
    if (id === undefined) {
      id = vocab.size;
      vocab.set(t, id);
    }
    return id;
  };
  const segments: Segment<T>[] = [];
  let current: T[] = [];
  let currentVec: Map<number, number> | null = null;
  // Whether the CURRENT (open) segment started after a boundary — the first
  // segment of the stream does not.
  let currentBoundary = false;

  const seal = () => {
    if (current.length > 0) {
      segments.push({ items: current, boundaryBefore: currentBoundary, sealedVector: currentVec ?? undefined });
    }
    current = [];
    currentVec = null;
    currentBoundary = true; // any segment opened after a seal starts at a boundary
  };

  for (const t of turns) {
    if (t.structuralBreak && current.length > 0) seal();
    const ids = tokensOf(t.text).map(idOf);
    const curCounts = new Map<number, number>();
    for (const id of ids) curCounts.set(id, (curCounts.get(id) ?? 0) + 1);
    const curUnit = unit(curCounts);
    if (currentVec && cosineSparse(curUnit, currentVec) < threshold) {
      seal();
      currentVec = runningVector(null, ids, alpha);
    } else {
      currentVec = runningVector(currentVec, ids, alpha);
    }
    current.push(t);
  }
  seal();
  return segments;
}
