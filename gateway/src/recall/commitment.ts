// V2 ⑦: CLS small-step contract — first-pass pipeline writes to the slow
// system's store commit at a capped energy. Retrieval of FRESH content is
// served by the t1 verbatim layer (FTT dual-trace); gists mature here.
// Graduation (decay pass) lifts survivors to 0.75 after the 48h window.
import { HarmonicUnit, HarmonicIndexEntry } from '../core/memory/harmonic-types';

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

/** Entries whose 48h window elapsed with no grace verdict: graduate to
 * COMMITMENT_GRADUATE_TO. Guards: cap stamp present (never inflate
 * naturally-low entries), energy still ≤ cap (not already raised), not
 * superseded, no rejected anchor, slow-system types only. "Survived the
 * window without interference = stabilized" (synaptic consolidation default). */
export function selectGraduations(entries: HarmonicIndexEntry[], now: number): string[] {
  const out: string[] = [];
  for (const e of entries) {
    if ((e as any).commitment_capped_at === undefined) continue;
    if (e.superseded_by) continue;
    if ((e.cue_anchors ?? []).includes('rejected')) continue;
    if (e.type !== 'semantic' && e.type !== 'procedural') continue;
    if (e.energy > COMMITMENT_CAP + 0.02) continue; // already graduated/promoted
    const cappedAt = Date.parse((e as any).commitment_capped_at);
    if (!Number.isFinite(cappedAt) || now - cappedAt < COMMITMENT_WINDOW_MS) continue;
    out.push(e.id);
  }
  return out;
}
