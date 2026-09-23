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
