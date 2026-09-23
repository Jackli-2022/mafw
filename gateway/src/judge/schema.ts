export interface SchemaFastPathInput {
  /** Nearest existing SEMANTIC-memory cosine (0 when none). */
  nearestSemanticCosine?: number;
  /** Memory type. */
  type: string;
}

export interface SchemaFastPathResult {
  /** Initial energy (0.8 default; higher when schema-consistent). */
  energy: number;
  /** Whether the memory matched an existing schema (one-trial fast path). */
  schemaConsistent: boolean;
}

/**
 * Schema fast path (Phase D1, mPFC analog): a new SEMANTIC memory that is
 * highly similar to an existing semantic cluster is schema-consistent → written
 * with a higher initial energy (one-trial fast consolidation), rather than the
 * slow path. Deterministic (cosine threshold), not an LLM.
 */
export function schemaFastPath(input: SchemaFastPathInput): SchemaFastPathResult {
  const c = input.nearestSemanticCosine ?? 0;
  if (input.type === 'semantic' && c >= 0.9) {
    const energy = Math.min(1, 0.8 + 0.15 * ((c - 0.9) / 0.1));
    return { energy, schemaConsistent: true };
  }
  return { energy: 0.8, schemaConsistent: false };
}
