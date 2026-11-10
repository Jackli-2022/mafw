/**
 * Adapter-local contract mirrors.
 *
 * `@mafw/runtime-contract` owns the neutral driver contract; a couple of seams
 * the gateway still declares inline (credential lookup) have no named export
 * there yet. Mirrors stay structural so gateway values keep type-checking after
 * the driver moved out — Plan 6 Task 5 allows a local `types.ts` for exactly
 * this case.
 */

/** Provider credential lookup (`RuntimeFactoryContext.credentials` shape). */
export interface RuntimeCredentials {
  getApiKey(provider: string): string | null;
}
