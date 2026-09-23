// S3: observation salience — deterministic scalar integration at encoding time.
// The brain gates encoding by neuromodulatory salience (novelty / emotion /
// reward / repetition). This computes a cheap, LLM-free scalar so the turn
// pipeline can prioritize which observations to replay (S2). It never drops
// data — every observation is still stored; only its tag changes.
import { calculateSalience } from '../core/memory/salience-perceptor';

export interface ObsSalienceSignals {
  text: string;
  /** 0..1 novelty (embedding distance to recent observations). Missing → 0.5 (neutral). */
  novelty?: number;
  /** Count of near-duplicate recent observations; higher → less salient. */
  repetition?: number;
  /** 0..1 reward signal (tool success/failure, user feedback). */
  reward?: number;
}

/**
 * Centered scalar integration → score in [0,1]. Neutral inputs (no signal) → 0.5.
 *   novelty  → centered to [-1,1]  (weight 0.5)
 *   emotion  → calculateSalience 0.5/1.0/1.5 → -1/0/1  (weight 0.3)
 *   reward   → 0..1                (weight 0.2)
 *   repetition → 0..1              (penalty 0.4)
 */
export function obsSalience(s: ObsSalienceSignals): { score: number } {
  const nc = ((s.novelty ?? 0.5) - 0.5) * 2; // -1..1
  const em = (calculateSalience(s.text) - 1.0) / 0.5; // -1..1
  const rw = Math.max(0, Math.min(1, s.reward ?? 0)); // 0..1
  const rep = Math.min(1, (s.repetition ?? 0) / 3); // 0..1
  const signal = 0.5 * nc + 0.3 * em + 0.2 * rw - 0.4 * rep;
  return { score: Math.max(0, Math.min(1, 0.5 + 0.5 * signal)) };
}
