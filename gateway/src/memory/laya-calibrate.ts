// Calibration analysis for the laya three-way gate. Reads judged-pair audit
// records (consolidation-pairs.jsonl) and proposes tauLow from the REAL
// distribution — the only sanctioned way to open the low band.
// tauHigh is never auto-proposed (separate-class blindness band 0.899-0.926).

export interface LayaPairRecord {
  layaScores?: Array<{ id: string; p: number }>;
  verdict: 'create' | 'update' | string;
  decidedBy?: string;
  ts: number;
}

export interface BucketDistribution {
  total: number;
  noScores: number;
  byVerdict: Record<string, Record<string, number>>;
}

export interface TauLowProposal {
  tauLow: number;
  minUpdateP: number;
  maxCreateBelow: number;
  scoredPairs: number;
  updatePairs: number;
}

const BUCKETS = ['0.0-0.1', '0.1-0.2', '0.2-0.3', '0.3-0.4', '0.4-0.5', '0.5-0.6', '0.6-0.7', '0.7-0.8', '0.8-0.9', '0.9-1.0'];
const MIN_SCORED = 50;
const MIN_UPDATES = 5;
const SANITY_CEILING = 0.3;

function bucketOf(p: number): string {
  const i = Math.min(BUCKETS.length - 1, Math.max(0, Math.floor(p * 10)));
  return BUCKETS[i];
}

/** Max laya score per record (the score the gate would act on). */
function recordScore(r: LayaPairRecord): number | null {
  if (!r.layaScores || r.layaScores.length === 0) return null;
  return Math.max(...r.layaScores.map((s) => s.p));
}

export function bucketDistribution(records: LayaPairRecord[]): BucketDistribution {
  const byVerdict: Record<string, Record<string, number>> = {};
  let total = 0;
  let noScores = 0;
  for (const r of records) {
    const p = recordScore(r);
    if (p === null) { noScores++; continue; }
    total++;
    const v = r.verdict || 'unknown';
    byVerdict[v] = byVerdict[v] ?? {};
    const b = bucketOf(p);
    byVerdict[v][b] = (byVerdict[v][b] ?? 0) + 1;
  }
  return { total, noScores, byVerdict };
}

export function proposeTauLow(
  records: LayaPairRecord[],
): { proposal: TauLowProposal | null; reason?: string } {
  const scored = records
    .map((r) => ({ p: recordScore(r), verdict: r.verdict }))
    .filter((x): x is { p: number; verdict: string } => x.p !== null);
  if (scored.length < MIN_SCORED) {
    return { proposal: null, reason: `need >= ${MIN_SCORED} scored pairs, have ${scored.length}` };
  }
  const updates = scored.filter((x) => x.verdict === 'update').map((x) => x.p);
  if (updates.length < MIN_UPDATES) {
    return { proposal: null, reason: `need >= ${MIN_UPDATES} update-verdict pairs, have ${updates.length}` };
  }
  const minUpdateP = Math.min(...updates);
  const createsBelow = scored.filter((x) => x.verdict === 'create' && x.p < minUpdateP).map((x) => x.p);
  if (createsBelow.length === 0) {
    return { proposal: null, reason: 'no create pairs below the update band — no safe line' };
  }
  const maxCreateBelow = Math.max(...createsBelow);
  // Safe line exists only if NO create score sits above minUpdateP.
  const createsAbove = scored.filter((x) => x.verdict === 'create' && x.p >= minUpdateP).length;
  if (createsAbove > 0) {
    return { proposal: null, reason: `${createsAbove} create pair(s) overlap the update band (>= ${minUpdateP})` };
  }
  return {
    proposal: {
      tauLow: Math.min(minUpdateP, SANITY_CEILING),
      minUpdateP,
      maxCreateBelow,
      scoredPairs: scored.length,
      updatePairs: updates.length,
    },
  };
}
