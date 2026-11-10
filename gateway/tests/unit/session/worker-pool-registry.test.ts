// SessionWorkerPool × session registry: worker SESSION records (not the pair
// cache — that is keyed by the SOURCE session, which is a user session and
// must never be labeled kind 'worker'). Worker sessions register at creation
// with role/origin/TTL, refresh with their pair, and unregister at pair
// eviction / overflow / disposeAll.
// Plan: docs/superpowers/plans/2026-11-10-gateway-kernel-session-registry.md (Task 4, revised by ruling)
import { SessionRegistry } from '../../../src/session';
import { SessionWorkerPool } from '../../../src/recall/session-worker-pool';
import { setWorkerOriginRegistryForTest } from '../../../src/recall/worker-origin';

function makeClient() {
  let seq = 0;
  return {
    session: {
      create: async () => ({ id: `w-${++seq}` }),
      prompt: async () => ({ parts: [{ type: 'text', text: 'ok' }] }),
      summarize: async () => true,
      delete: async () => {},
    },
  };
}

describe('SessionWorkerPool × session registry (revised Task 4)', () => {
  let registry: SessionRegistry;

  beforeEach(() => {
    registry = new SessionRegistry();
    setWorkerOriginRegistryForTest(registry);
  });

  afterEach(() => {
    setWorkerOriginRegistryForTest(null);
  });

  it('worker sessions register as kind-worker records with role + origin + TTL', async () => {
    const pool = new SessionWorkerPool({
      client: makeClient() as any,
      directory: '/tmp',
      ttlMs: 60_000,
      registry,
    });
    const worker = pool.getWorker('src-1', 'extract');
    await worker.prompt('hi', 'sys'); // creates the worker session
    const recs = registry.byScope({ kind: 'worker' });
    expect(recs.length).toBe(1);
    expect(recs[0].scope.role).toBe('extract');
    expect(recs[0].metadata.originSessionID).toBe('src-1');
    expect(recs[0].ttlMs).toBe(60_000);
    await pool.disposeAll();
  });

  it('pair touch refreshes the worker records of that source', async () => {
    const pool = new SessionWorkerPool({
      client: makeClient() as any,
      directory: '/tmp',
      ttlMs: 60_000,
      registry,
    });
    const worker = pool.getWorker('src-1', 'extract');
    await worker.prompt('hi', 'sys');
    const before = registry.byScope({ kind: 'worker' })[0].expiresAt;
    // A second getWorker on the same source touches the pair + worker records.
    pool.getWorker('src-1', 'reflect');
    const after = registry.byScope({ kind: 'worker' })[0].expiresAt;
    expect(after).toBeGreaterThanOrEqual(before);
    await pool.disposeAll();
  });

  it('pair TTL eviction unregisters its worker records (dispose exactly once)', async () => {
    let disposed = 0;
    const client = makeClient();
    const pool = new SessionWorkerPool({
      client: client as any,
      directory: '/tmp',
      ttlMs: 50,
      registry,
    });
    const worker = pool.getWorker('src-1', 'extract');
    // Track disposal: MemoryWorker.dispose deletes the session.
    const origDelete = client.session.delete.bind(client.session);
    (client.session as any).delete = async () => { disposed++; await origDelete(); };
    await worker.prompt('hi', 'sys');
    const rec = registry.byScope({ kind: 'worker' })[0];
    expect(rec).toBeDefined();
    expect(rec.metadata.originSessionID).toBe('src-1');
    await new Promise((r) => setTimeout(r, 80));
    pool.getWorker('src-2', 'extract'); // triggers entries.sweep() → evicts the expired src-1 pair
    // Worker record truly removed (lookup returns null only on removal —
    // byScope would hide an expired-but-unswept record).
    expect(registry.lookup(rec.sessionID)).toBeNull();
    // Exactly-once: only the extract session existed (reflect was never
    // prompted); a double-dispose bug would count 2.
    expect(disposed).toBe(1);
    await pool.disposeAll();
  });

  it('disposeAll unregisters every worker record', async () => {
    const pool = new SessionWorkerPool({
      client: makeClient() as any,
      directory: '/tmp',
      ttlMs: 60_000,
      registry,
    });
    await pool.getWorker('src-1', 'extract').prompt('hi', 'sys');
    await pool.getWorker('src-2', 'reflect').prompt('hi', 'sys');
    expect(registry.byScope({ kind: 'worker' }).length).toBe(2);
    await pool.disposeAll();
    expect(registry.byScope({ kind: 'worker' }).length).toBe(0);
  });

  it('overflow eviction (maxSessions) drops the oldest pair and its worker records', async () => {
    const pool = new SessionWorkerPool({
      client: makeClient() as any,
      directory: '/tmp',
      ttlMs: 60_000,
      maxSessions: 1,
      registry,
    });
    await pool.getWorker('src-1', 'extract').prompt('hi', 'sys');
    expect(registry.byScope({ kind: 'worker' }).length).toBe(1);
    // Second source overflows the cap → oldest (src-1) evicted.
    await pool.getWorker('src-2', 'extract').prompt('hi', 'sys');
    const recs = registry.byScope({ kind: 'worker' });
    expect(recs.length).toBe(1);
    expect(recs[0].metadata.originSessionID).toBe('src-2');
    await pool.disposeAll();
  });

  it('sweeper-driven eviction: registry.sweep() alone disposes the pair exactly once (deferred minor)', async () => {
    let disposed = 0;
    const client = makeClient();
    const pool = new SessionWorkerPool({
      client: client as any,
      directory: '/tmp',
      ttlMs: 50,
      registry,
    });
    const origDelete = client.session.delete.bind(client.session);
    (client.session as any).delete = async () => { disposed++; await origDelete(); };
    const worker = pool.getWorker('src-1', 'extract');
    await worker.prompt('hi', 'sys');
    expect(pool.size()).toBe(1);
    await new Promise((r) => setTimeout(r, 80));
    // No getWorker access — the unified sweeper alone must bound the idle pair.
    const swept = registry.sweep();
    expect(swept).toBeGreaterThanOrEqual(1);
    expect(disposed).toBe(1);          // exactly once (the created session)
    expect(pool.size()).toBe(0);        // TtlMap entry removed too
    expect(registry.byScope({ kind: 'worker' }).length).toBe(0); // records gone
    await pool.disposeAll();            // idempotent: no further disposal
    expect(disposed).toBe(1);
  });

  it('evictedSources guard is FIFO-bounded (minor fix)', async () => {
    const Cap = (SessionWorkerPool as unknown as { EVICTED_SOURCES_CAP: number });
    const original = Cap.EVICTED_SOURCES_CAP;
    Cap.EVICTED_SOURCES_CAP = 5; // small cap for a cheap test
    try {
      const pool = new SessionWorkerPool({
        client: makeClient() as any,
        directory: '/tmp',
        ttlMs: 60_000,
        registry,
      });
      // Seven one-shot sources: create + evict each.
      for (let i = 0; i < 7; i++) {
        pool.getWorker(`src-${i}`, 'extract');
        (pool as any).evictPair(`src-${i}`);
      }
      const guard = (pool as any).evictedSources as Set<string>;
      expect(guard.size).toBeLessThanOrEqual(5);
      expect(guard.has('src-0')).toBe(false); // oldest trimmed
      expect(guard.has('src-6')).toBe(true);
      // A fresh register re-arms its guard (the trimmed src-0 works again).
      pool.getWorker('src-0', 'extract');
      (pool as any).evictPair('src-0');
      expect(guard.has('src-0')).toBe(true);
      await pool.disposeAll();
    } finally {
      Cap.EVICTED_SOURCES_CAP = original;
    }
  });

  it('sweeper eviction with BOTH worker sessions: sibling unregistered mid-sweep, guard holds', async () => {
    let disposed = 0;
    const client = makeClient();
    const pool = new SessionWorkerPool({
      client: client as any,
      directory: '/tmp',
      ttlMs: 50,
      registry,
    });
    const origDelete = client.session.delete.bind(client.session);
    (client.session as any).delete = async () => { disposed++; await origDelete(); };
    // Prompt BOTH kinds → two worker records exist; the first record's
    // sweeper eviction unregisters the sibling mid-sweep (snapshot iteration).
    await pool.getWorker('src-1', 'extract').prompt('hi', 'sys');
    await pool.getWorker('src-1', 'reflect').prompt('hi', 'sys');
    expect(registry.byScope({ kind: 'worker' }).length).toBe(2);
    await new Promise((r) => setTimeout(r, 80));
    const swept = registry.sweep();
    expect(swept).toBeGreaterThanOrEqual(1);
    expect(disposed).toBe(2);          // both sessions, each exactly once
    expect(pool.size()).toBe(0);
    expect(registry.byScope({ kind: 'worker' }).length).toBe(0);
    await pool.disposeAll();
    expect(disposed).toBe(2);          // guard: nothing double-disposed
  });

  it('role overlay coexists on the worker record (Review Focus 4)', async () => {
    const pool = new SessionWorkerPool({
      client: makeClient() as any,
      directory: '/tmp',
      ttlMs: 60_000,
      registry,
    });
    const worker = pool.getWorker('src-1', 'extract');
    await worker.prompt('hi', 'sys');
    const rec = registry.byScope({ kind: 'worker' })[0];
    // The internal-roles overlay patches the same record — no duplicates.
    registry.updateMetadata(rec.sessionID, { role: 'worker-extract' });
    pool.getWorker('src-1', 'reflect'); // touch — overlay survives
    const after = registry.byScope({ kind: 'worker' })[0];
    expect(after.metadata.role).toBe('worker-extract');
    expect(after.metadata.originSessionID).toBe('src-1');
    expect(registry.size().active).toBe(1); // still ONE record
    await pool.disposeAll();
  });
});
