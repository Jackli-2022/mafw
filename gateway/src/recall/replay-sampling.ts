// S2: replay priority — the brain replays salient/recent sequences
// preferentially (sharp-wave ripples), not uniformly. This scores which turns
// to include in the consolidation prompt when the transcript budget is tight.
export interface ReplayPrioritySignals {
  /** 0..1 observation salience (S3). */
  salience: number;
  /** 0..1 novelty (embedding distance to recent turns). */
  novelty: number;
  /** Age of the turn in hours. */
  ageHours: number;
  /** Recency decay constant in hours (default 24). */
  tauHours?: number;
}

export function replayPriority(p: ReplayPrioritySignals): number {
  const tau = p.tauHours ?? 24;
  return p.salience * (1 + p.novelty) * Math.exp(-Math.max(0, p.ageHours) / tau);
}

/**
 * Greedy budget-respecting selection by descending priority. Items whose length
 * would exceed the remaining budget are skipped (a later smaller item may still
 * fit), so a single oversized item cannot starve the transcript.
 */
export function sampleByPriority<T>(
  items: T[],
  score: (x: T) => number,
  budget: number,
  len: (x: T) => number,
): T[] {
  const sorted = [...items].sort((a, b) => score(b) - score(a));
  const out: T[] = [];
  let used = 0;
  for (const it of sorted) {
    const l = len(it);
    if (used + l > budget) continue;
    out.push(it);
    used += l;
  }
  return out;
}
