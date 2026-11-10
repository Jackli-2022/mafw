// InternalRolesView: the internalSessionRoles Map replacement — a metadata
// overlay over the session registry. One record per sessionID; when another
// view owns the record (pool worker, lead, pod), this view only patches
// metadata.role and the owner keeps the lifetime.
// Plan: docs/superpowers/plans/2026-11-10-gateway-kernel-session-registry.md (Task 2)
import { SessionRegistry } from '../../../src/session';
import { InternalRolesView } from '../../../src/session/views/internal-roles';

describe('InternalRolesView', () => {
  it('set → get returns the role; view owns the record (kind internal, scope.role)', () => {
    const r = new SessionRegistry();
    const v = new InternalRolesView(r);
    v.set('s1', 'btw');
    expect(v.get('s1')).toBe('btw');
    expect(v.has('s1')).toBe(true);
    const rec = r.lookup('s1')!;
    expect(rec.scope.kind).toBe('internal');
    expect(rec.scope.role).toBe('btw');
  });

  it('set on a foreign-owned record patches metadata in place (owner keeps TTL + metadata)', () => {
    const r = new SessionRegistry();
    const v = new InternalRolesView(r);
    // A pool worker record: TTL 24h, owned metadata.
    r.register({ sessionID: 'w1', scope: { kind: 'worker' }, metadata: { pair: { id: 1 } }, ttlMs: 24 * 3600_000 });
    v.set('w1', 'worker-extract');
    const rec = r.lookup('w1')!;
    expect(rec.metadata.role).toBe('worker-extract');
    expect(rec.metadata.pair).toEqual({ id: 1 }); // owner's metadata survives
    expect(rec.ttlMs).toBe(24 * 3600_000);       // owner's TTL untouched
    expect(rec.scope.kind).toBe('worker');        // ownership unchanged
    expect(v.get('w1')).toBe('worker-extract');
  });

  it('has → true only when a role is present', () => {
    const r = new SessionRegistry();
    const v = new InternalRolesView(r);
    r.register({ sessionID: 'plain', scope: { kind: 'worker' } }); // record without role
    expect(v.has('plain')).toBe(false);
    v.set('plain', 'media');
    expect(v.has('plain')).toBe(true);
  });

  it('delete on an internally-owned record unregisters it', () => {
    const r = new SessionRegistry();
    const v = new InternalRolesView(r);
    v.set('s1', 'btw');
    expect(v.delete('s1')).toBe(true);
    expect(r.lookup('s1')).toBeNull();
    expect(v.get('s1')).toBeUndefined();
  });

  it('delete on a foreign-owned record clears the role; the record survives', () => {
    const r = new SessionRegistry();
    const v = new InternalRolesView(r);
    r.register({ sessionID: 'w1', scope: { kind: 'worker' }, metadata: { pair: {} }, ttlMs: 1000 });
    v.set('w1', 'worker-reflect');
    expect(v.delete('w1')).toBe(true);
    expect(v.get('w1')).toBeUndefined();
    const rec = r.lookup('w1')!;
    expect(rec).not.toBeNull();      // owner's record survives
    expect(rec.metadata.pair).toEqual({}); // owner's metadata intact
    expect(rec.metadata.role).toBeUndefined();
  });

  it('get for an unknown sid → undefined', () => {
    const r = new SessionRegistry();
    const v = new InternalRolesView(r);
    expect(v.get('gone')).toBeUndefined();
    expect(v.has('gone')).toBe(false);
    expect(v.delete('gone')).toBe(false);
  });

  it('set on an expired-but-unswept record re-registers (not dropped at next sweep)', async () => {
    const r = new SessionRegistry();
    const v = new InternalRolesView(r);
    r.register({ sessionID: 's1', scope: { kind: 'worker' }, metadata: { pair: {} }, ttlMs: 50 });
    await new Promise<void>((resolve) => setTimeout(resolve, 80));
    v.set('s1', 'media'); // the record is lazy-ended — treat as absent, re-register
    expect(v.get('s1')).toBe('media');
    const rec = r.lookup('s1')!;
    expect(rec.status).toBe('active');     // re-registered, not silently swept away
    expect(rec.generation).toBe(2);         // lifecycle continued
    expect(rec.scope.kind).toBe('internal'); // the view now owns the record (old pair was dead anyway)
    expect(rec.scope.role).toBe('media');
  });

  it('delete on a foreign record with NO role set → false (Map.delete semantics)', () => {
    const r = new SessionRegistry();
    const v = new InternalRolesView(r);
    r.register({ sessionID: 'plain', scope: { kind: 'worker' }, ttlMs: 1000 });
    expect(v.delete('plain')).toBe(false); // nothing to delete
    expect(r.lookup('plain')).not.toBeNull(); // record untouched
    v.set('plain', 'media');
    expect(v.delete('plain')).toBe(true); // role was present
  });
});
