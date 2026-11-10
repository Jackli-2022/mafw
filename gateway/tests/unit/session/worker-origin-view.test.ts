// worker-origin as a registry view: originSessionID is metadata on the
// worker's record (created by the pool, or TTL-less by this view when the
// worker record is absent). Signatures unchanged for callers.
// Plan: docs/superpowers/plans/2026-11-10-gateway-kernel-session-registry.md (Task 3)
import { SessionRegistry } from '../../../src/session';
import {
  registerWorkerOrigin,
  resolveWorkerOrigin,
  clearWorkerOrigins,
  setWorkerOriginRegistryForTest,
} from '../../../src/recall/worker-origin';

describe('worker-origin view', () => {
  let registry: SessionRegistry;

  beforeEach(() => {
    registry = new SessionRegistry();
    setWorkerOriginRegistryForTest(registry);
  });

  afterEach(() => {
    clearWorkerOrigins();
    setWorkerOriginRegistryForTest(null);
  });

  it('register → resolve returns the origin (patches metadata on an existing record)', () => {
    registry.register({ sessionID: 'w1', scope: { kind: 'worker' }, metadata: { pair: {} }, ttlMs: 1000 });
    registerWorkerOrigin('w1', 'source-1');
    expect(resolveWorkerOrigin('w1')).toBe('source-1');
    const rec = registry.lookup('w1')!;
    expect(rec.metadata.originSessionID).toBe('source-1');
    expect(rec.metadata.pair).toEqual({}); // owner's metadata survives
    expect(rec.ttlMs).toBe(1000);          // owner's TTL untouched
  });

  it('register for an unknown sid creates a TTL-less worker record', () => {
    registerWorkerOrigin('w2', 'source-2');
    expect(resolveWorkerOrigin('w2')).toBe('source-2');
    const rec = registry.lookup('w2')!;
    expect(rec.scope.kind).toBe('worker');
    expect(rec.ttlMs).toBeNull(); // persists like the old module Map did
  });

  it('resolve for an unknown sid → null; blank ids ignored', () => {
    expect(resolveWorkerOrigin('gone')).toBeNull();
    registerWorkerOrigin('', 'x');
    registerWorkerOrigin('w3', '');
    expect(resolveWorkerOrigin('w3')).toBeNull();
  });

  it('clear → origin gone; view-created records removed, owner records survive', () => {
    registry.register({ sessionID: 'w1', scope: { kind: 'worker' }, metadata: { pair: {} }, ttlMs: 1000 });
    registerWorkerOrigin('w1', 'source-1');
    registerWorkerOrigin('w2', 'source-2'); // view-created
    clearWorkerOrigins();
    expect(resolveWorkerOrigin('w1')).toBeNull();
    expect(resolveWorkerOrigin('w2')).toBeNull();
    // Owner record survives with its metadata intact.
    expect(registry.lookup('w1')?.metadata.pair).toEqual({});
    // View-created record is gone entirely.
    expect(registry.lookup('w2')).toBeNull();
  });

  it('register on an expired-but-unswept record re-registers (deferred minor)', async () => {
    const r = new SessionRegistry();
    setWorkerOriginRegistryForTest(r);
    r.register({ sessionID: 'w1', scope: { kind: 'worker' }, metadata: { pair: {} }, ttlMs: 50 });
    await new Promise<void>((resolve) => setTimeout(resolve, 80));
    registerWorkerOrigin('w1', 'source-late'); // record is lazy-ended — treat as absent
    expect(resolveWorkerOrigin('w1')).toBe('source-late');
    const rec = r.lookup('w1')!;
    expect(rec.status).toBe('active');
    expect(rec.generation).toBe(2);
    expect(rec.metadata.originSessionID).toBe('source-late');
  });
});
