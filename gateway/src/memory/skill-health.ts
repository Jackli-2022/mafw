/**
 * Skill v1 6B health gate.
 *
 * Deopt only on concrete evidence: all source memories are gone/superseded, or
 * repeated mechanical tool failures without any known success. Usage that is
 * merely `unknown` or absent never triggers a deopt.
 */
export interface SkillSourceState {
  id?: string;
  exists: boolean;
  superseded: boolean;
}

export interface SkillHealthStats {
  total: number;
  success: number;
  failure: number;
  unknown: number;
}

export interface SkillHealthDecision {
  deopt: boolean;
  reason?: 'source-superseded' | 'repeated-failure';
}

export function shouldDeoptSkill(input: {
  sources: SkillSourceState[];
  stats: SkillHealthStats;
  failureThreshold?: number;
}): SkillHealthDecision {
  const sources = input.sources ?? [];
  if (sources.length > 0 && sources.every((s) => !s.exists || s.superseded)) {
    return { deopt: true, reason: 'source-superseded' };
  }
  const threshold = Math.max(1, input.failureThreshold ?? 3);
  if ((input.stats?.failure ?? 0) >= threshold && (input.stats?.success ?? 0) === 0) {
    return { deopt: true, reason: 'repeated-failure' };
  }
  return { deopt: false };
}
