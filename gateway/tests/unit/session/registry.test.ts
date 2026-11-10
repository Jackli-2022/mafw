// Unified session registry (process table): one record per sessionID.
// Spec: docs/superpowers/specs/2026-11-09-gateway-kernel-session-registry-design.md
// Plan: docs/superpowers/plans/2026-11-10-gateway-kernel-session-registry.md (Task 1)
import {
  SessionRegistry,
  SessionRecord,
} from '../../../src/session';

function clock(start = 1_000_000) {
  let now = start;
  return {
    advance(ms: number) { now += ms; },
    now: () => now,
  };
}

describe('SessionRegistry', () => {
  it('register → lookup returns the record (active, generation 1)', () => {
    const r = new SessionRegistry();
    const rec = r.register({ sessionID: 's1', scope: { kind: 'worker' }, metadata: { role: 'extract' } });
    expect(rec.status).toBe('active');
    expect(rec.generation).toBe(1);
    const found = r.lookup('s1');
    expect(found?.sessionID).toBe('s1');
    expect(found?.scope.kind).toBe('worker');
    expect(found?.metadata.role).toBe('extract');
    expect(found?.ttlMs).toBeNull();
    expect(found?.expiresAt).toBeNull();
  });

  it('single-record rule: re-register an active record → scope replaced, generation kept, metadata merged', () => {
    const r = new SessionRegistry();
    r.register({ sessionID: 's1', scope: { kind: 'internal', role: 'btw' }, metadata: { a: 1 } });
    const rec = r.register({ sessionID: 's1', scope: { kind: 'worker' }, metadata: { b: 2 } });
    expect(rec.generation).toBe(1);
    expect(r.size().active).toBe(1);
    const found = r.lookup('s1')!;
    expect(found.scope.kind).toBe('worker'); // new owner takes the record
    expect(found.metadata.a).toBe(1);        // metadata merged, not replaced
    expect(found.metadata.b).toBe(2);
  });

  it('register over an ended record → generation +1, back to active', () => {
    const c = clock();
    const r = new SessionRegistry({ now: c.now });
    r.register({ sessionID: 's1', scope: { kind: 'worker' }, ttlMs: 1000 });
    c.advance(2000);
    expect(r.lookup('s1')?.status).toBe('ended');
    const rec = r.register({ sessionID: 's1', scope: { kind: 'worker' } });
    expect(rec.generation).toBe(2);
    expect(r.lookup('s1')?.status).toBe('active');
  });

  it('register after sweep → generation continues from the retired stash', () => {
    const c = clock();
    const r = new SessionRegistry({ now: c.now });
    r.register({ sessionID: 's1', scope: { kind: 'worker' }, ttlMs: 1000 });
    c.advance(2000);
    expect(r.sweep()).toBe(1);
    expect(r.lookup('s1')).toBeNull();
    const rec = r.register({ sessionID: 's1', scope: { kind: 'worker' } });
    expect(rec.generation).toBe(2); // retired generation + 1
  });

  it('unregister → lookup null; re-register continues the generation', () => {
    const r = new SessionRegistry();
    r.register({ sessionID: 's1', scope: { kind: 'lead', projectId: 'p' } });
    expect(r.unregister('s1')).toBe(true);
    expect(r.lookup('s1')).toBeNull();
    expect(r.unregister('s1')).toBe(false);
    const rec = r.register({ sessionID: 's1', scope: { kind: 'lead', projectId: 'p' } });
    expect(rec.generation).toBe(2);
  });

  it('TTL expiry is lazy: lookup shows ended, record stays until sweep', () => {
    const c = clock();
    const r = new SessionRegistry({ now: c.now });
    r.register({ sessionID: 's1', scope: { kind: 'worker' }, ttlMs: 5000 });
    c.advance(4999);
    expect(r.lookup('s1')?.status).toBe('active');
    c.advance(2);
    expect(r.lookup('s1')?.status).toBe('ended'); // materialized on read
    expect(r.size()).toEqual({ active: 0, ended: 1 }); // still in the table
  });

  it('sweep() collects expired, fires per-record onEvict, returns count', () => {
    const c = clock();
    const r = new SessionRegistry({ now: c.now });
    let evicted: SessionRecord | null = null;
    r.register({
      sessionID: 's1', scope: { kind: 'worker' }, ttlMs: 1000,
      onEvict: (rec) => { evicted = rec; },
    });
    r.register({ sessionID: 's2', scope: { kind: 'lead', projectId: 'p' } }); // no TTL
    c.advance(5000);
    expect(r.sweep()).toBe(1);
    expect((evicted as SessionRecord | null)?.sessionID).toBe('s1');
    expect((evicted as SessionRecord | null)?.status).toBe('ended');
    expect(r.lookup('s1')).toBeNull();
    expect(r.lookup('s2')).not.toBeNull(); // untouched
  });

  it('sweep() does not evict TTL-less records', () => {
    const c = clock();
    const r = new SessionRegistry({ now: c.now });
    r.register({ sessionID: 's1', scope: { kind: 'lead', projectId: 'p' } });
    c.advance(365 * 24 * 3600_000); // a year
    expect(r.sweep()).toBe(0);
    expect(r.lookup('s1')?.status).toBe('active');
  });

  it('touch() refreshes expiresAt and lastActiveAt', () => {
    const c = clock();
    const r = new SessionRegistry({ now: c.now });
    r.register({ sessionID: 's1', scope: { kind: 'worker' }, ttlMs: 10_000 });
    c.advance(8000);
    const touchedAt = c.now();
    expect(r.touch('s1')).toBe(true);
    c.advance(5000); // 3s past the ORIGINAL expiry, 5s inside the refreshed one
    expect(r.lookup('s1')?.status).toBe('active');
    expect(r.lookup('s1')!.lastActiveAt).toBe(touchedAt);
    expect(r.touch('gone')).toBe(false);
  });

  it('byScope matches provided fields, excludes expired', () => {
    const c = clock();
    const r = new SessionRegistry({ now: c.now });
    r.register({ sessionID: 'a', scope: { kind: 'goal', goalId: 'g1', revision: 1, podId: 'p', memberId: 'm1' } });
    r.register({ sessionID: 'b', scope: { kind: 'goal', goalId: 'g1', revision: 2, podId: 'p', memberId: 'm2' } });
    r.register({ sessionID: 'c', scope: { kind: 'goal', goalId: 'g2', revision: 1, podId: 'p', memberId: 'm1' }, ttlMs: 1000 });
    r.register({ sessionID: 'd', scope: { kind: 'worker' } });
    c.advance(5000); // c expired
    expect(r.byScope({ kind: 'goal', goalId: 'g1' }).map((x) => x.sessionID).sort()).toEqual(['a', 'b']);
    expect(r.byScope({ kind: 'goal', podId: 'p' }).map((x) => x.sessionID).sort()).toEqual(['a', 'b']);
    expect(r.byScope({ kind: 'worker' }).map((x) => x.sessionID)).toEqual(['d']);
    expect(r.byScope({}).length).toBe(3); // active only
  });

  it('byScope revision participates in matching', () => {
    const r = new SessionRegistry();
    r.register({ sessionID: 'a', scope: { kind: 'goal', goalId: 'g1', revision: 1 } });
    r.register({ sessionID: 'b', scope: { kind: 'goal', goalId: 'g1', revision: 2 } });
    expect(r.byScope({ kind: 'goal', goalId: 'g1', revision: 2 }).map((x) => x.sessionID)).toEqual(['b']);
  });

  it('updateMetadata merges into an existing record; false for unknown', () => {
    const r = new SessionRegistry();
    r.register({ sessionID: 's1', scope: { kind: 'worker' }, metadata: { a: 1 } });
    expect(r.updateMetadata('s1', { b: 2 })).toBe(true);
    expect(r.lookup('s1')?.metadata).toEqual({ a: 1, b: 2 });
    expect(r.updateMetadata('gone', { b: 2 })).toBe(false);
  });

  it('size() counts active and ended', () => {
    const c = clock();
    const r = new SessionRegistry({ now: c.now });
    r.register({ sessionID: 'a', scope: { kind: 'worker' }, ttlMs: 1000 });
    r.register({ sessionID: 'b', scope: { kind: 'worker' } });
    c.advance(2000);
    expect(r.size()).toEqual({ active: 1, ended: 1 });
  });

  it('unregister does NOT fire onEvict (explicit paths own disposal)', () => {
    const r = new SessionRegistry();
    let evicted = 0;
    r.register({ sessionID: 's1', scope: { kind: 'worker' }, onEvict: () => { evicted++; } });
    r.unregister('s1');
    expect(evicted).toBe(0);
  });

  it('metadata defaults to {} when absent', () => {
    const r = new SessionRegistry();
    const rec = r.register({ sessionID: 's1', scope: { kind: 'worker' } });
    expect(rec.metadata).toEqual({});
  });

  it('retiredGenerations is bounded (FIFO trim at 10k)', () => {
    const c = clock();
    const r = new SessionRegistry({ now: c.now });
    for (let i = 0; i < 10_050; i++) {
      r.register({ sessionID: `s${i}`, scope: { kind: 'worker' }, ttlMs: 1 });
    }
    c.advance(10);
    r.sweep();
    // The first sid (oldest retired) was trimmed → re-register restarts at 1.
    expect(r.register({ sessionID: 's0', scope: { kind: 'worker' } }).generation).toBe(1);
    // A recent retirement still continues.
    expect(r.register({ sessionID: 's10049', scope: { kind: 'worker' } }).generation).toBe(2);
  });

  it('register over ended resets createdAt and REPLACES metadata (deferred minor)', () => {
    const c = clock();
    const r = new SessionRegistry({ now: c.now });
    r.register({ sessionID: 's1', scope: { kind: 'worker' }, metadata: { stale: true }, ttlMs: 1000 });
    c.advance(2000);
    const createdBefore = r.lookup('s1')!.createdAt;
    c.advance(1000);
    const rec = r.register({ sessionID: 's1', scope: { kind: 'worker' }, metadata: { fresh: true } });
    expect(rec.createdAt).toBeGreaterThan(createdBefore); // fresh lifecycle
    expect(rec.metadata).toEqual({ fresh: true });          // stale metadata not merged
  });

  it('materialize never leaks the onEvict callback on public copies (deferred minor)', () => {
    const r = new SessionRegistry();
    r.register({
      sessionID: 's1', scope: { kind: 'worker' },
      onEvict: () => {},
    });
    expect((r.lookup('s1') as any).onEvict).toBeUndefined();
    expect((r.byScope({ kind: 'worker' })[0] as any).onEvict).toBeUndefined();
  });
});
