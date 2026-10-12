// V2 ⑦: CLS small-step contract — first-pass pipeline writes to the slow
// system's store commit at a capped energy. Retrieval of FRESH content is
// served by the t1 verbatim layer (FTT dual-trace); gists mature here.
// Graduation (decay pass) lifts survivors to 0.75 after the 48h window.
import { HarmonicUnit } from '../core/memory/harmonic-types';

export const COMMITMENT_CAP = 0.6;
export const COMMITMENT_GRADUATE_TO = 0.75;
export const COMMITMENT_WINDOW_MS = 48 * 3600 * 1000;

export const commitmentStats = { capped: 0, graduated: 0 };

export interface CapOpts {
  isPipeline: boolean;
  /** Master flag (config.recall.commitmentGradient, default true). */
  enabled?: boolean;
  cap?: number;
  now?: string;
}

export function capCommitment(unit: HarmonicUnit, opts: CapOpts): HarmonicUnit {
  if (opts.enabled === false) return unit;
  if (!opts.isPipeline) return unit;
  if (unit.type !== 'semantic' && unit.type !== 'procedural') return unit;
  const cap = opts.cap ?? COMMITMENT_CAP;
  commitmentStats.capped++;
  const stamped = { ...unit, commitment_capped_at: opts.now ?? new Date().toISOString() } as HarmonicUnit;
  if (unit.energy <= cap) return stamped;
  return { ...stamped, energy: cap };
}
