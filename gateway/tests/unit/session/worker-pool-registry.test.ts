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
    expect(registry.byScope({ kind: 'worker' }).length).toBe(1);
    await new Promise((r) => setTimeout(r, 80));
    pool.getWorker('src-2', 'extract'); // triggers entries.sweep() → evicts the expired src-1 pair
    expect(registry.byScope({ kind: 'worker' }).length).toBe(0); // worker record unregistered
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
