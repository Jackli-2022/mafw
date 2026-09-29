// B4: reward-modulated consolidation (Adcock et al. 2006, PMID 16675403;
// Murayama & Kitagami 2014, PMID 23421444; ExpeL arXiv:2308.10144).
// A PASS verdict bumps the energy of memories written during the goal's
// sessions — asymmetric by design: failure never drains, because a failed
// goal still contains correct facts (misattribution guard). The bonus rides
// the replay loop: rewarded memories surface via the same need×gain priority
// (Mattar & Daw 2018).
import { HarmonicIndexManager } from '../../core/memory/harmonic-index';
import { log } from '../../core/utils/logger';

/** Only PASS is rewarded (verdict vocabulary: PASS/FAIL/MAX_RETRIES/ERROR/CANCELLED). */
export function goalRewardBonus(verdict: string): number {
  return verdict === 'PASS' ? 0.08 : 0;
}

export function applyGoalReward(
  deps: { index: HarmonicIndexManager; sessions: string[] },
  verdict: string,
): { rewarded: number } {
  const delta = goalRewardBonus(verdict);
  if (delta <= 0) return { rewarded: 0 };
  try {
    const set = new Set(deps.sessions);
    let rewarded = 0;
    for (const entry of deps.index.getIndex().entries) {
      if (!entry.source_session_id || !set.has(entry.source_session_id)) continue;
      if (entry.superseded_by) continue; // dead versions stay dead
      const room = Math.max(0, 1.0 - entry.energy);
      const applied = Math.min(delta, room);
      if (applied > 0) deps.index.updateEnergy(entry.id, applied);
      rewarded++;
    }
    return { rewarded };
  } catch (err: any) {
    log.warn?.(`[GoalReward] failed: ${err?.message || err}`);
    return { rewarded: 0 };
  }
}
