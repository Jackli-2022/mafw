// A3: ACT-R base-level activation as the retrieval-strengthening math
// (Anderson: B = ln Σ t^-d). A linear "+0.02/hit" is the worst form:
// unbounded, old events never fade, and it feeds back through retrieval ×
// energy (popularity bias, arXiv:2007.13019). Log form + probability
// weighting + cap + exposure discount are the documented mitigations
// (docs/research/2026-09-29-memory-gap-abc-survey.md §A3).
import { RetrievalEvent } from './retrieval-events';

export interface BonusOptions {
  /** ACT-R decay exponent (default 0.5). */
  d?: number;
  /** Age offset in hours so fresh events stay finite (default 24). */
  offsetHours?: number;
  /** Upper bound on the applied bonus (default 0.05 — one day's decay order). */
  cap?: number;
  /** Scale applied to ln(1+activation) (default 0.1). */
  k?: number;
  /** Injections beyond this count in the batch start the exposure discount (default 5). */
  exposureThreshold?: number;
  /** Discount strength per extra injection (default 0.3). */
  exposureDiscount?: number;
}

/**
 * ACT-R log-form bonus for ONE memory's event batch (the daily decay pass
 * groups drained events by id and calls this per entry).
 */
export function actrBonus(events: RetrievalEvent[], now: number, opts: BonusOptions = {}): number {
  if (!events || events.length === 0) return 0;
  const d = opts.d ?? 0.5;
  const offset = opts.offsetHours ?? 24;
  const cap = opts.cap ?? 0.05;
  const k = opts.k ?? 0.1;
  const thr = opts.exposureThreshold ?? 5;
  const disc = opts.exposureDiscount ?? 0.3;

  let activation = 0;
  for (const e of events) {
    const ageHours = Math.max(0, (now - e.ts) / 3600_000);
    // prob ∈ [0,1] weights the hit; invalid → full weight, floored at 0.2 so
    // a low-confidence hit still counts as a retrieval
    const w = Number.isFinite(e.prob) ? Math.max(0.2, Math.min(1, e.prob)) : 1;
    activation += w * Math.pow(ageHours + offset, -d);
  }
  let bonus = k * Math.log1p(activation);
  if (events.length > thr) {
    bonus /= 1 + disc * (events.length - thr);
  }
  return Math.max(0, Math.min(cap, bonus));
}
