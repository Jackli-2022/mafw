// PodSessionSupervisor observe-sync into the session registry (Task 6):
// ensure mirrors goal-scoped records (leaseKind metadata), retire/dead-lease
// unmirrors. Supervisor lease logic untouched.
// Plan: docs/superpowers/plans/2026-11-10-gateway-kernel-session-registry.md (Task 6)
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PodStore } from '../../../src/core/pod/pod-store';
import {
  PodSessionSupervisor,
  type PodSessionScope,
} from '../../../src/core/pod/pod-session-supervisor';
import { SessionRegistry } from '../../../src/session';

const NOW = '2026-11-10T00:00:00.000Z';

describe('PodSessionSupervisor session-registry mirror (Task 6)', () => {
  let dir: string;
  let store: PodStore;
  let supervisor: PodSessionSupervisor;
  let registry: SessionRegistry;
  let alive: Set<string>;
  let seq: number;

  const scope = (overrides: Partial<PodSessionScope> = {}): PodSessionScope => ({
    podId: 'pod_1',
    memberId: 'm_builder',
    goalId: 'g1',
    revision: 1,
    kind: 'discussion',
    ...overrides,
  });

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-pod-mirror-'));
    const db = new Database(path.join(dir, 'test.db'));
    store = new PodStore(db);
    store.ensurePod({ id: 'pod_1', projectDir: '/proj/a', name: 'A', now: NOW });
    registry = new SessionRegistry();
    alive = new Set();
    seq = 0;
    supervisor = new PodSessionSupervisor({
      store,
      now: () => NOW,
      newId: () => `id_${++seq}`,
      runtimeName: () => 'opencode',
      isAlive: (sid: string) => alive.has(sid),
      sessionRegistry: registry,
    });
  });

  it('ensure mirrors a goal-scoped record with revision + memberId + leaseKind', async () => {
    const lease = await supervisor.ensure(scope(), () => 'ses_builder_1');
    const recs = registry.byScope({ kind: 'goal', goalId: 'g1', revision: 1, podId: 'pod_1', memberId: 'm_builder' });
    expect(recs.map((r) => r.sessionID)).toEqual([lease.sessionId]);
    expect(recs[0].metadata.leaseKind).toBe('discussion');
    expect(recs[0].generation).toBe(lease.generation);
  });

  it('retire unmirrors the ended session', async () => {
    const lease = await supervisor.ensure(scope(), () => 'ses_builder_1');
    expect(registry.byScope({ kind: 'goal' }).length).toBe(1);
    expect(supervisor.retire(scope())).toBe(true);
    expect(registry.byScope({ kind: 'goal' }).length).toBe(0);
    expect(registry.lookup(lease.sessionId)).toBeNull();
  });

  it('no dep → supervisor works exactly as before', async () => {
    const bare = new PodSessionSupervisor({
      store,
      now: () => NOW,
      newId: () => `id_${++seq}`,
      runtimeName: () => 'opencode',
      isAlive: (sid: string) => alive.has(sid),
    });
    const lease = await bare.ensure(scope(), () => 'ses_builder_1');
    expect(lease.reused).toBe(false);
    alive.add('ses_builder_1'); // the lease session is alive → next ensure reuses
    const again = await bare.ensure(scope(), () => { throw new Error('should not create'); });
    expect(again.sessionId).toBe(lease.sessionId);
    expect(again.reused).toBe(true);
  });

  it('re-ensure after retire continues the generation', async () => {
    const first = await supervisor.ensure(scope(), () => 'ses_builder_1');
    supervisor.retire(scope());
    const second = await supervisor.ensure(scope(), () => 'ses_builder_2');
    expect(second.generation).toBe(first.generation + 1);
    const recs = registry.byScope({ kind: 'goal', goalId: 'g1' });
    expect(recs.map((r) => r.sessionID)).toEqual([second.sessionId]);
  });
});
