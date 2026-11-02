import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PodStore } from '../../../src/core/pod/pod-store';
import { PodService, type PodServiceDeps } from '../../../src/core/pod/pod-service';
import {
  PodSessionSupervisor,
  type PodSessionScope,
} from '../../../src/core/pod/pod-session-supervisor';

const NOW = '2026-11-02T00:00:00.000Z';
const LATER = '2026-11-02T00:10:00.000Z';

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

  const makeService = (overrides: Partial<PodServiceDeps> = {}) => new PodService({
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
    ...overrides,
  });

  const seedSession = (sessionId: string, overrides: Partial<Parameters<PodStore['insertSession']>[0]> = {}) =>
    store.insertSession({
      id: `ps_${sessionId}`,
      podId: 'pod_1',
      memberId: 'm_builder',
      goalId: 'g1',
      node: null,
      sessionId,
      status: 'active',
      transcriptRef: null,
      now: NOW,
      ...overrides,
    });

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

  test('PodService.reconcile leaves idle supervisor leases alone while reaping legacy node sessions', async () => {
    await supervisor.ensure(scope(), async () => 'ses_scoped');
    seedSession('ses_node', { node: 'execute' });

    const service = makeService();

    await expect(service.reconcile()).resolves.toBeUndefined();

    // 作用域会话的「idle」只是本轮结束：租约复用不能被 reconcile 收尾。
    expect(store.getSessionBySessionId('ses_scoped')).toMatchObject({ endedAt: null });
    expect(store.getSnapshot('ses_scoped')).toBeNull();
    expect(store.getActiveScopedSession(scope())?.sessionId).toBe('ses_scoped');
    // 旧节点会话仍按回合 idle 正常收尾。
    expect(store.getSessionBySessionId('ses_node')?.endedAt).toBeTruthy();
    expect(store.getSnapshot('ses_node')).not.toBeNull();
  });

  test('reconcile finalizes a scoped lease whose runtime session disappeared (I-2)', async () => {
    await supervisor.ensure(scope(), async () => 'ses_scoped');

    // runtime 返回空（会话已不存在）：idle 豁免不能把它留成永久 active。
    await makeService({ getSession: async () => null as any }).reconcile();

    expect(store.getSessionBySessionId('ses_scoped')?.endedAt).toBeTruthy();
    expect(store.getSnapshot('ses_scoped')).not.toBeNull();
    expect(store.getActiveScopedSession(scope())).toBeNull();
  });

  test('reconcile finalizes a scoped lease on a not-found runtime error (I-2)', async () => {
    await supervisor.ensure(scope(), async () => 'ses_scoped');

    const service = makeService({
      getSession: async () => {
        throw new Error('session 404 not found');
      },
      messages: async () => {
        throw new Error('messages gone');
      },
    });
    await service.reconcile();

    const snapshot = store.getSnapshot('ses_scoped');
    expect(snapshot).not.toBeNull();
    expect(JSON.parse(fs.readFileSync(snapshot!.path, 'utf-8')).unavailable).toBe(true);
    expect(store.getSessionBySessionId('ses_scoped')?.endedAt).toBeTruthy();
  });

  test('reconcile still leaves a scoped lease alone on a transient lookup error (I-2)', async () => {
    await supervisor.ensure(scope(), async () => 'ses_scoped');

    await makeService({
      getSession: async () => {
        throw new Error('transport timeout');
      },
    }).reconcile();

    expect(store.getSessionBySessionId('ses_scoped')?.endedAt).toBeNull();
    expect(store.getSnapshot('ses_scoped')).toBeNull();
  });

  test('the DB enforces at most one active lease per exact scope (I-1)', async () => {
    await supervisor.ensure(scope(), async () => 'ses_first');

    // 同作用域、不同 runtime 会话的第二条活跃行必须被唯一部分索引拒绝。
    expect(() => db.prepare(`
      INSERT INTO pod_member_sessions (
        id, pod_id, member_id, goal_id, node, session_id, status,
        scope_kind, revision, generation, created_at
      ) VALUES ('ps_second', 'pod_1', 'm_builder', 'g1', NULL, 'ses_second', 'active', 'discussion', 1, 1, ?)
    `).run(NOW)).toThrow(/UNIQUE constraint failed/);

    // 结束旧租约后同一作用域可以重建（历史行保留，不冲突）。
    supervisor.retire(scope());
    const rebuilt = await supervisor.ensure(scope(), async () => 'ses_second');
    expect(rebuilt).toEqual({ sessionId: 'ses_second', generation: 2, reused: false });
    expect(store.listActiveSessions('pod_1').filter((row) => row.scopeKind)).toHaveLength(1);
  });

  test('insertSession reports an ignored insert instead of returning an empty row (I-1)', async () => {
    await supervisor.ensure(scope(), async () => 'ses_first');

    expect(() => seedSession('ses_dup', {
      scopeKind: 'discussion',
      revision: 1,
      lastActiveAt: NOW,
    })).toThrow(/insert was ignored/);
    expect(store.getSessionBySessionId('ses_dup')).toBeNull();
  });

  test('a lease inserted by another instance wins the race without duplicating the scope (I-1)', async () => {
    const disposed: string[] = [];
    const racer = build({
      dispose: async (sessionId) => {
        disposed.push(sessionId);
      },
    });

    const lease = await racer.ensure(scope(), async () => {
      // 竞争实例在 create 期间抢先写入同一作用域的活跃租约。
      db.prepare(`
        INSERT INTO pod_member_sessions (
          id, pod_id, member_id, goal_id, node, session_id, status,
          scope_kind, revision, generation, created_at
        ) VALUES ('ps_winner', 'pod_1', 'm_builder', 'g1', NULL, 'ses_winner', 'active', 'discussion', 1, 1, ?)
      `).run(NOW);
      return 'ses_late';
    });

    expect(lease).toEqual({ sessionId: 'ses_winner', generation: 1, reused: true });
    expect(disposed).toEqual(['ses_late']);
    expect(store.listActiveSessions('pod_1').filter((row) => row.scopeKind === 'discussion')).toHaveLength(1);
    expect(store.getSessionBySessionId('ses_late')).toBeNull();
  });

  test('opening a DB with duplicate active leases keeps the newest and rebuilds the index (I-1)', () => {
    const dupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-pod-dup-'));
    const dupPath = path.join(dupDir, 'dup.db');

    // 先按当前 schema 建库，再删掉唯一索引写入两条同作用域活跃租约（旧版本/手工数据）。
    const seedDb = new Database(dupPath);
    new PodStore(seedDb);
    seedDb.exec('DROP INDEX idx_pod_member_sessions_active_scope');
    const insert = seedDb.prepare(`
      INSERT INTO pod_member_sessions (
        id, pod_id, member_id, goal_id, node, session_id, status,
        scope_kind, revision, generation, created_at
      ) VALUES (?, 'pod_1', 'm_builder', 'g1', NULL, ?, 'active', 'discussion', 1, ?, ?)
    `);
    insert.run('ps_old', 'ses_old', 1, NOW);
    insert.run('ps_new', 'ses_new', 2, LATER);
    seedDb.close();

    const reopened = new Database(dupPath);
    const migrated = new PodStore(reopened);

    expect(migrated.getActiveScopedSession(scope())?.sessionId).toBe('ses_new');
    expect(migrated.getSessionBySessionId('ses_old')?.endedAt).toBeTruthy();
    // 索引已重建：再插一条活跃行会被拒。
    expect(() => reopened.prepare(`
      INSERT INTO pod_member_sessions (
        id, pod_id, member_id, goal_id, node, session_id, status,
        scope_kind, revision, generation, created_at
      ) VALUES ('ps_third', 'pod_1', 'm_builder', 'g1', NULL, 'ses_third', 'active', 'discussion', 1, 3, ?)
    `).run(NOW)).toThrow(/UNIQUE constraint failed/);

    reopened.close();
    fs.rmSync(dupDir, { recursive: true, force: true });
  });

  test('a claimed runtime session is never disposed: 409 + structured warning only (I-3 round 2)', async () => {
    seedSession('ses_taken', { node: 'execute' });
    const disposed: string[] = [];
    const logs: string[] = [];
    const guarded = build({
      dispose: async (sessionId) => {
        disposed.push(sessionId);
      },
      log: (message) => logs.push(message),
    });

    await expect(guarded.ensure(scope(), async () => 'ses_taken')).rejects.toMatchObject({
      status: 409,
    });

    // 这行会话在本次调用之前就存在（别的作用域/节点持有）：一旦接线
    // runtime.session.delete，dispose 会删掉别人的活会话与 transcript。
    expect(disposed).toEqual([]);
    expect(logs.some((line) => line.includes('refusing to lease existing session ses_taken'))).toBe(true);
    expect(logs.some((line) => line.includes('releasing unleased session'))).toBe(false);
    // 被拒的会话不产生租约行，作用域保持不变。
    expect(store.getActiveScopedSession(scope())).toBeNull();
    expect(store.getScopedGeneration(scope())).toBe(0);
    // 原会话保持完好。
    expect(store.getSessionBySessionId('ses_taken')?.endedAt).toBeNull();
  });

  test('a session_id unique collision is classified as pre-existing: no dispose (I-3 round 2)', async () => {
    const disposed: string[] = [];
    const logs: string[] = [];
    const guarded = build({
      dispose: async (sessionId) => {
        disposed.push(sessionId);
      },
      log: (message) => logs.push(message),
    });
    // 模拟「claimed 检查之后、INSERT 之前」另一实例抢占了同一 runtime 会话 id：
    // SQLite 对该列报 `UNIQUE constraint failed: pod_member_sessions.session_id`。
    const insert = jest.spyOn(store, 'leaseScopedSession').mockImplementation(() => {
      throw new Error('UNIQUE constraint failed: pod_member_sessions.session_id');
    });

    try {
      await expect(guarded.ensure(scope(), async () => 'ses_foreign')).rejects.toMatchObject({
        status: 409,
      });
    } finally {
      insert.mockRestore();
    }

    expect(disposed).toEqual([]);
    expect(logs.some((line) => line.includes('refusing to lease existing session ses_foreign'))).toBe(true);
    expect(store.getActiveScopedSession(scope())).toBeNull();
  });

  test('a failing dispose on the race path is logged and never masks the reuse (I-3 round 2)', async () => {
    const logs: string[] = [];
    const racer = build({
      dispose: async () => {
        throw new Error('runtime refusing');
      },
      log: (message) => logs.push(message),
    });

    const lease = await racer.ensure(scope(), async () => {
      // 竞争实例在 create 期间抢先写入同一作用域的活跃租约。
      db.prepare(`
        INSERT INTO pod_member_sessions (
          id, pod_id, member_id, goal_id, node, session_id, status,
          scope_kind, revision, generation, created_at
        ) VALUES ('ps_winner', 'pod_1', 'm_builder', 'g1', NULL, 'ses_winner', 'active', 'discussion', 1, 1, ?)
      `).run(NOW);
      return 'ses_late';
    });

    expect(lease).toEqual({ sessionId: 'ses_winner', generation: 1, reused: true });
    expect(logs.some((line) => line.includes('dispose failed for unleased session ses_late'))).toBe(true);
    expect(store.listActiveSessions('pod_1').filter((row) => row.scopeKind === 'discussion')).toHaveLength(1);
  });

  test('undefined goalId/revision normalize to null across ensure/current/retire (M6)', async () => {
    // 调用方（route/SDK 透传）可能给 undefined，语义应与 null 相同。
    const loose = {
      podId: 'pod_1',
      memberId: 'm_builder',
      kind: 'project',
    } as unknown as PodSessionScope;
    const project = scope({ goalId: null, revision: null, kind: 'project' });

    const lease = await supervisor.ensure(loose, async () => 'ses_project');
    expect(lease).toEqual({ sessionId: 'ses_project', generation: 1, reused: false });
    expect(store.getActiveScopedSession(project)?.sessionId).toBe('ses_project');

    // 同一作用域（显式 null）命中复用，不会建第二条。
    await expect(supervisor.ensure(project, async () => 'ses_never'))
      .resolves.toEqual({ sessionId: 'ses_project', generation: 1, reused: true });
    await expect(supervisor.current(loose)).resolves.toEqual({
      sessionId: 'ses_project',
      generation: 1,
      reused: true,
    });
    expect(supervisor.retire(loose)).toBe(true);
    expect(store.getActiveScopedSession(project)).toBeNull();
  });

  test('NULL goal/revision are distinct scopes, not wildcards (M10)', async () => {
    const combos: Array<{ key: string; value: PodSessionScope; sessionId: string }> = [
      { key: 'null/null', value: scope({ goalId: null, revision: null }), sessionId: 'ses_null_null' },
      { key: 'null/1', value: scope({ goalId: null, revision: 1 }), sessionId: 'ses_null_1' },
      { key: 'g1/null', value: scope({ goalId: 'g1', revision: null }), sessionId: 'ses_g1_null' },
      { key: 'g1/1', value: scope({ goalId: 'g1', revision: 1 }), sessionId: 'ses_g1_1' },
    ];

    for (const combo of combos) {
      await expect(supervisor.ensure(combo.value, async () => combo.sessionId))
        .resolves.toEqual({ sessionId: combo.sessionId, generation: 1, reused: false });
    }

    // 每个精确作用域只命中自己的租约（NULL 不是通配符）。
    for (const combo of combos) {
      expect(store.getActiveScopedSession(combo.value)?.sessionId).toBe(combo.sessionId);
      expect(store.getScopedGeneration(combo.value)).toBe(1);
      await expect(supervisor.current(combo.value)).resolves.toMatchObject({ sessionId: combo.sessionId });
    }
    expect(store.listActiveSessions('pod_1').filter((row) => row.scopeKind)).toHaveLength(4);
  });
});
