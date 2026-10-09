/**
 * Unified abstraction degree for a memory system (orthogonal to `type`):
 * episodic=1 (concrete instance), semantic|procedural=2, global=3.
 * Replaces the per-write-path mappings that had drifted (procedural→3, global→4).
 */
export function abstractionLevelFor(type: string): number {
  if (type === 'episodic') return 1;
  if (type === 'global') return 3;
  return 2;
}

/**
 * Per-system daily energy-decay rate (layered decay, Phase C4a):
 * the fast episodic layer forgets faster; stable semantic/procedural/global
 * layers decay slower. Aligns with the brain's fast/slow system asymmetry.
 */
export function decayRateFor(type: string): number {
  if (type === 'episodic') return 0.010;
  if (type === 'procedural') return 0.003;
  if (type === 'global') return 0.001;
  return 0.005; // semantic
}

/**
 * D5 CATD (EngramRAG arXiv:2609.32049): scale the decay rate by topological
 * load — entries whose knowledge is depended upon by many others (high
 * weighted degree in the anchor graph) forget slower; isolated entries are
 * unchanged. β=0 disables the modulation; degree 0 returns the base rate.
 */
export function catdDecayRate(baseRate: number, weightedDegree: number, beta: number = 0.5): number {
  if (beta <= 0 || weightedDegree <= 0) return baseRate;
  return baseRate / (1 + beta * Math.log1p(weightedDegree));
}
