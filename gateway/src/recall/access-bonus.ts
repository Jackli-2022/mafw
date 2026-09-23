// S5: retrieval access bonus. A memory that is retrieved (and thus used) is
// strengthened — the brain's retrieval-driven reconsolidation window. Only the
// explicit retrieval path applies this; the boundary recall path (100ms
// contract) does not.
export function applyAccessBonus(
  ids: string[],
  index: { updateEnergy(id: string, delta: number): void },
  delta: number = 0.02,
): void {
  for (const id of ids) {
    try {
      index.updateEnergy(id, delta);
    } catch {
      /* fail-open */
    }
  }
}
