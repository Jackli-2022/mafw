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
