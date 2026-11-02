import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PodStore } from '../../../src/core/pod/pod-store';
import { PodService } from '../../../src/core/pod/pod-service';
import {
  PodSessionSupervisor,
  type PodSessionScope,
} from '../../../src/core/pod/pod-session-supervisor';

const NOW = '2026-11-02T00:00:00.000Z';

describe('PodSessionSupervisor', () => {
  let dir: string;
  let db: Database.Database;
  let store: PodStore;
  let memoryRoot: string;
  let projectDir: string;
  let seq: number;
  let clock: number;
  let supervisor: PodSessionSupervisor;

  const now = () => new Date(Date.UTC(2026, 10, 2, 0, 0, clock++)).toISOString();
  const newId = () => `id_${++seq}`;
  const scope = (overrides: Partial<PodSessionScope> = {}): PodSessionScope => ({
    podId: 'pod_1',
    memberId: 'm_builder',
    goalId: 'g1',
    revision: 1,
    kind: 'discussion',
    ...overrides,
  });
  const build = (deps: Partial<ConstructorParameters<typeof PodSessionSupervisor>[0]> = {}) =>
    new PodSessionSupervisor({ store, now, newId, ...deps });

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-pod-supervisor-'));
    db = new Database(path.join(dir, 'test.db'));
    store = new PodStore(db);
    store.ensurePod({ id: 'pod_1', projectDir: '/proj/a', name: 'A', now: NOW });
    memoryRoot = path.join(dir, 'pods');
    projectDir = path.join(dir, 'project');
    fs.mkdirSync(projectDir, { recursive: true });
    seq = 0;
    clock = 0;
    supervisor = build();
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('reuses a live lease for the exact scope', async () => {
    let created = 0;
    const create = async () => {
      created++;
      return created === 1 ? 'ses_a' : 'ses_b';
    };

    const first = await supervisor.ensure(scope(), create);
    const second = await supervisor.ensure(scope(), create);

    expect(first).toEqual({ sessionId: 'ses_a', generation: 1, reused: false });
    expect(second).toEqual({ sessionId: 'ses_a', generation: 1, reused: true });
    expect(created).toBe(1);
    expect(store.getActiveScopedSession(scope())?.sessionId).toBe('ses_a');
    expect(store.getSessionBySessionId('ses_a')?.lastActiveAt).toBeTruthy();
  });

  test('separates leases by revision, kind, goal, member and pod', async () => {
    const base = await supervisor.ensure(scope(), async () => 'ses_base');
    const otherRevision = await supervisor.ensure(scope({ revision: 2 }), async () => 'ses_rev2');
    const otherKind = await supervisor.ensure(scope({ kind: 'review' }), async () => 'ses_review');
    const otherGoal = await supervisor.ensure(scope({ goalId: 'g2' }), async () => 'ses_goal2');
    const projectScope = await supervisor.ensure(scope({ goalId: null, revision: null, kind: 'project' }), async () => 'ses_project');
    const otherMember = await supervisor.ensure(scope({ memberId: 'm_reviewer' }), async () => 'ses_member');
    const otherPod = await supervisor.ensure(scope({ podId: 'pod_2' }), async () => 'ses_pod2');

    expect([base, otherRevision, otherKind, otherGoal, projectScope, otherMember, otherPod].map((lease) => lease.sessionId))
      .toEqual(['ses_base', 'ses_rev2', 'ses_review', 'ses_goal2', 'ses_project', 'ses_member', 'ses_pod2']);
    expect([base, otherRevision, otherKind, otherGoal, projectScope, otherMember, otherPod].map((lease) => lease.generation))
      .toEqual([1, 1, 1, 1, 1, 1, 1]);
    expect(otherRevision.reused).toBe(false);
    expect(otherKind.reused).toBe(false);
  });

  test('retires a dead lease and rebuilds it with the next generation (brief scenario)', async () => {
    const first = await supervisor.ensure(scope(), async () => 'ses_a');
    expect(first).toEqual({ sessionId: 'ses_a', generation: 1, reused: false });

    const dead = build({ isAlive: async () => false });
    const recovered = await dead.ensure(scope(), async () => 'ses_recovered');

    expect(recovered).toMatchObject({ sessionId: 'ses_recovered', generation: 2, reused: false });
    expect(store.getSessionBySessionId('ses_a')?.endedAt).toBeTruthy();
    expect(store.getActiveScopedSession(scope())?.sessionId).toBe('ses_recovered');

    // 恢复后的租约照常复用（生成号不再递增）。
    const reused = await build({ isAlive: async () => true }).ensure(scope(), async () => 'ses_never');
    expect(reused).toEqual({ sessionId: 'ses_recovered', generation: 2, reused: true });
  });

  test('treats an isAlive failure as alive so a transient runtime error never destroys a lease', async () => {
    await supervisor.ensure(scope(), async () => 'ses_a');

    const flaky = build({
      isAlive: async () => {
        throw new Error('runtime warming up');
      },
    });
    const lease = await flaky.ensure(scope(), async () => 'ses_b');

    expect(lease).toEqual({ sessionId: 'ses_a', generation: 1, reused: true });
    expect(store.getSessionBySessionId('ses_a')?.endedAt).toBeNull();
  });

  test('current returns the live lease without creating or mutating one', async () => {
    await expect(supervisor.current(scope())).resolves.toBeNull();

    await supervisor.ensure(scope(), async () => 'ses_a');
    await expect(supervisor.current(scope())).resolves.toEqual({
      sessionId: 'ses_a',
      generation: 1,
      reused: true,
    });
    await expect(supervisor.current(scope({ revision: 2 }))).resolves.toBeNull();

    const dead = build({ isAlive: async () => false });
    await expect(dead.current(scope())).resolves.toBeNull();
    // current 只读：不结束、也不重建。
    expect(store.getSessionBySessionId('ses_a')?.endedAt).toBeNull();
  });

  test('retire ends only the scoped session', async () => {
    await supervisor.ensure(scope(), async () => 'ses_a');
    await supervisor.ensure(scope({ kind: 'review' }), async () => 'ses_review');
    await supervisor.ensure(scope({ memberId: 'm_reviewer' }), async () => 'ses_member');

    expect(supervisor.retire(scope())).toBe(true);
    expect(store.getSessionBySessionId('ses_a')?.endedAt).toBeTruthy();
    expect(store.getSessionBySessionId('ses_review')?.endedAt).toBeNull();
    expect(store.getSessionBySessionId('ses_member')?.endedAt).toBeNull();
    expect(supervisor.retire(scope())).toBe(false);

    // 退休后重建：生成号沿该作用域的 max + 1 继续。
    const rebuilt = await supervisor.ensure(scope(), async () => 'ses_a2');
    expect(rebuilt).toEqual({ sessionId: 'ses_a2', generation: 2, reused: false });
  });

  test('a failed create leaves no lease behind and the next attempt starts at generation 1', async () => {
    await expect(supervisor.ensure(scope(), async () => {
      throw new Error('runtime down');
    })).rejects.toThrow('runtime down');

    expect(store.getActiveScopedSession(scope())).toBeNull();
    expect(store.getScopedGeneration(scope())).toBe(0);

    const recovered = await supervisor.ensure(scope(), async () => 'ses_ok');
    expect(recovered).toEqual({ sessionId: 'ses_ok', generation: 1, reused: false });
  });

  test('scoped rows keep their scope metadata and leave legacy rows untouched', async () => {
    await supervisor.ensure(scope(), async () => 'ses_scoped');
    store.insertSession({
      id: 'ps_legacy',
      podId: 'pod_1',
      memberId: 'm_builder',
      goalId: 'g1',
      node: 'execute',
      sessionId: 'ses_legacy',
      status: 'active',
      transcriptRef: null,
      now: NOW,
    });

    expect(store.getSessionBySessionId('ses_scoped')).toMatchObject({
      sessionId: 'ses_scoped',
      memberId: 'm_builder',
      goalId: 'g1',
      node: null,
      scopeKind: 'discussion',
      revision: 1,
      generation: 1,
      endedAt: null,
    });
    expect(store.getSessionBySessionId('ses_legacy')).toMatchObject({
      scopeKind: null,
      revision: null,
      generation: 1,
      lastActiveAt: null,
    });
    // 未知 scope_kind（历史脏值/手工写入）按非托管读，不会被当成 Supervisor 租约。
    db.prepare(`
      INSERT INTO pod_member_sessions (id, pod_id, member_id, goal_id, node, session_id, status, scope_kind, created_at)
      VALUES ('ps_dirty', 'pod_1', 'm_builder', 'g1', NULL, 'ses_dirty', 'active', 'mystery', ?)
    `).run(NOW);
    expect(store.getSessionBySessionId('ses_dirty')?.scopeKind).toBeNull();
    // 没有作用域元点的历史行不会命中作用域查找。
    expect(store.getActiveScopedSession(scope())?.sessionId).toBe('ses_scoped');
    expect(store.getActiveScopedSession(scope({ kind: 'probe' }))).toBeNull();
  });

  test('concurrent ensure calls for one scope share a single lease', async () => {
    let created = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const create = async () => {
      created++;
      await gate;
      return 'ses_once';
    };

    const first = supervisor.ensure(scope(), create);
    const second = supervisor.ensure(scope(), create);
    release();
    const [a, b] = await Promise.all([first, second]);

    expect(created).toBe(1);
    expect(a).toEqual(b);
    expect(a).toEqual({ sessionId: 'ses_once', generation: 1, reused: false });
    expect(store.listActiveSessions('pod_1').filter((row) => row.scopeKind === 'discussion')).toHaveLength(1);
  });

  test('refuses to lease a runtime session already bound to another scope', async () => {
    store.insertSession({
      id: 'ps_legacy',
      podId: 'pod_1',
      memberId: 'm_builder',
      goalId: 'g1',
      node: 'execute',
      sessionId: 'ses_taken',
      status: 'active',
      transcriptRef: null,
      now: NOW,
    });

    await expect(supervisor.ensure(scope(), async () => 'ses_taken')).rejects.toThrow(
      /already bound/,
    );
    expect(store.getActiveScopedSession(scope())).toBeNull();
    expect(store.getScopedGeneration(scope())).toBe(0);
  });

  test('a legacy pod_member_sessions table is migrated in place', async () => {
    const legacyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-pod-supervisor-legacy-'));
    const legacyPath = path.join(legacyDir, 'legacy.db');
    const legacyDb = new Database(legacyPath);
    legacyDb.exec(`
      CREATE TABLE pod_member_sessions (
        id TEXT PRIMARY KEY,
        pod_id TEXT NOT NULL,
        member_id TEXT NOT NULL,
        goal_id TEXT,
        node TEXT,
        session_id TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL,
        transcript_ref TEXT,
        created_at TEXT NOT NULL,
        ended_at TEXT
      );
    `);
    legacyDb.prepare(`
      INSERT INTO pod_member_sessions (id, pod_id, member_id, goal_id, node, session_id, status, created_at)
      VALUES ('ps_old', 'pod_1', 'm_builder', 'g1', 'execute', 'ses_old', 'active', ?)
    `).run(NOW);
    legacyDb.close();

    const migratedDb = new Database(legacyPath);
    const migratedStore = new PodStore(migratedDb);
    const migrated = new PodSessionSupervisor({ store: migratedStore, now, newId });

    expect(migratedStore.getSessionBySessionId('ses_old')).toMatchObject({
      sessionId: 'ses_old',
      scopeKind: null,
      revision: null,
      generation: 1,
      lastActiveAt: null,
      endedAt: null,
    });
    expect(migratedStore.getActiveScopedSession(scope())).toBeNull();

    const lease = await migrated.ensure(scope(), async () => 'ses_new');
    expect(lease).toEqual({ sessionId: 'ses_new', generation: 1, reused: false });
    expect(migratedStore.getActiveScopedSession(scope())?.sessionId).toBe('ses_new');

    migratedDb.close();
    fs.rmSync(legacyDir, { recursive: true, force: true });
  });

  test('PodService.reconcile leaves supervisor leases alone while reaping legacy node sessions', async () => {
    await supervisor.ensure(scope(), async () => 'ses_scoped');
    store.insertSession({
      id: 'ps_node',
      podId: 'pod_1',
      memberId: 'm_builder',
      goalId: 'g1',
      node: 'execute',
      sessionId: 'ses_node',
      status: 'active',
      transcriptRef: null,
      now: NOW,
    });

    const service = new PodService({
      store,
      now,
      newId,
      broadcast: () => {},
      getManagerSession: async () => 'ses_manager',
      getSession: async () => ({ time: { idle: 1 } }),
      messages: async () => [{ role: 'assistant', text: 'done' }],
      memoryRoot,
      listRegisteredProjectDirs: () => [projectDir],
      ensureMemory: () => {},
      log: () => {},
    });

    await expect(service.reconcile()).resolves.toBeUndefined();

    // 作用域会话的「idle」只是本轮结束：租约复用不能被 reconcile 收尾。
    expect(store.getSessionBySessionId('ses_scoped')).toMatchObject({ endedAt: null });
    expect(store.getSnapshot('ses_scoped')).toBeNull();
    expect(store.getActiveScopedSession(scope())?.sessionId).toBe('ses_scoped');
    // 旧节点会话仍按回合 idle 正常收尾。
    expect(store.getSessionBySessionId('ses_node')?.endedAt).toBeTruthy();
    expect(store.getSnapshot('ses_node')).not.toBeNull();
  });
});
