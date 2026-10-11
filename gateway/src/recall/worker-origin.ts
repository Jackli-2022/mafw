// V1 provenance fix: pipeline workers (turnCompress/reflection) write
// memories via HTTP with THEIR session id as source_session_id — those worker
// sessions never land in t1_archive, so C0 source reconstruction no-ops. This
// registry maps worker session id → the SOURCE session it was spawned for;
// the /api/memory/add route rewrites source_session_id through it.
//
// Bounded by distinct source sessions (the pool caps at ~64 live pairs);
// eviction pruning is accepted as a V1 simplification — stale entries are
// only readable, never harmful.
const origins = new Map<string, string>();

export function registerWorkerOrigin(workerSessionId: string, sourceSessionId: string): void {
  if (!workerSessionId || !sourceSessionId) return;
  origins.set(workerSessionId, sourceSessionId);
}

export function resolveWorkerOrigin(workerSessionId: string): string | null {
  return origins.get(workerSessionId) ?? null;
}

export function clearWorkerOrigins(): void {
  origins.clear();
}
