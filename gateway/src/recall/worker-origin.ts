// V1 provenance fix: pipeline workers (turnCompress/reflection) write
// memories via HTTP with THEIR session id as source_session_id — those worker
// sessions never land in t1_archive, so C0 source reconstruction no-ops. This
// view maps worker session id → the SOURCE session it was spawned for;
// the /api/memory/add route rewrites source_session_id through it.
//
// Kernel refactor Phase C: the module Map became a registry view —
// originSessionID is metadata on the worker's session record (owned by the
// SessionWorkerPool, or TTL-less here when the record is absent). Consumers
// register/test via setWorkerOriginRegistryForTest; production wiring shares
// the gateway's default registry so the pool's records are visible.
import { SessionRegistry, getDefaultSessionRegistry } from '../session';

let registry: SessionRegistry | null = null;

/** Test/isolation hook: swap the backing registry (null → default). */
export function setWorkerOriginRegistryForTest(r: SessionRegistry | null): void {
  registry = r;
}

function backing(): SessionRegistry {
  return registry ?? getDefaultSessionRegistry();
}

/** Marker: a record this view created itself (no other owner). */
const VIEW_OWNED = '__workerOriginView';

export function registerWorkerOrigin(workerSessionId: string, sourceSessionId: string): void {
  if (!workerSessionId || !sourceSessionId) return;
  const reg = backing();
  const existing = reg.lookup(workerSessionId);
  if (existing) {
    reg.updateMetadata(workerSessionId, { originSessionID: sourceSessionId });
    return;
  }
  reg.register({
    sessionID: workerSessionId,
    scope: { kind: 'worker' },
    metadata: { originSessionID: sourceSessionId, [VIEW_OWNED]: true },
  });
}

export function resolveWorkerOrigin(workerSessionId: string): string | null {
  const origin = backing().lookup(workerSessionId)?.metadata.originSessionID;
  return typeof origin === 'string' && origin.length > 0 ? origin : null;
}

export function clearWorkerOrigins(): void {
  const reg = backing();
  for (const rec of reg.byScope({ kind: 'worker' })) {
    if (rec.metadata[VIEW_OWNED] === true) {
      // View-created (TTL-less) records go away entirely.
      reg.unregister(rec.sessionID);
    } else {
      // Owner-created records survive; only the overlay is cleared.
      reg.updateMetadata(rec.sessionID, { originSessionID: undefined });
    }
  }
}
