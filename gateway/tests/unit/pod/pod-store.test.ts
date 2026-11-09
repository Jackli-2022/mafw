import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PodStore } from '../../../src/core/pod/pod-store';

describe('PodStore', () => {
  let dir: string;
  let db: Database.Database;
  let store: PodStore;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-pod-store-'));
    db = new Database(path.join(dir, 'test.db'));
    store = new PodStore(db);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('ensurePod is idempotent by projectDir and keeps the original id', () => {
    const first = store.ensurePod({
      id: 'pod_1',
      projectDir: '/proj/a',
      name: 'Project A',
      now: '2026-10-29T00:00:00.000Z',
    });
    const second = store.ensurePod({
      id: 'pod_2',
      projectDir: '/proj/a',
      name: 'Project A renamed',
      now: '2026-10-29T00:01:00.000Z',
    });
    const other = store.ensurePod({
      id: 'pod_2',
      projectDir: '/proj/b',
      name: 'Project B',
      now: '2026-10-29T00:02:00.000Z',
    });

    expect(second.id).toBe('pod_1');
    expect(second.name).toBe('Project A renamed');
    expect(other.id).toBe('pod_2');
    expect(store.getPodByProject('/proj/a')?.id).toBe('pod_1');
    expect(store.listPods()).toHaveLength(2);
  });

  test('findPodIdByGoal and getGoalByGoalId resolve an enqueued goal', () => {
    store.ensurePod({ id: 'pod_1', projectDir: '/proj/a', name: 'A', now: '2026-10-29T00:00:00.000Z' });
    const first = store.enqueueGoal({
      id: 'pg_1',
      podId: 'pod_1',
      goalId: 'g1',
      now: '2026-10-29T00:00:00.000Z',
    });
    const duplicate = store.enqueueGoal({
      id: 'pg_2',
      podId: 'pod_1',
      goalId: 'g1',
      now: '2026-10-29T00:01:00.000Z',
    });

    expect(first.status).toBe('queued');
    expect(duplicate.id).toBe('pg_1');
    expect(store.findPodIdByGoal('g1')).toBe('pod_1');
    expect(store.getGoalByGoalId('g1')?.podId).toBe('pod_1');
    expect(store.findPodIdByGoal('missing')).toBeNull();
  });

  test('upsertMember/listMembers return the three roles in canonical order', () => {
    store.ensurePod({ id: 'pod_1', projectDir: '/proj/a', name: 'A', now: '2026-10-29T00:00:00.000Z' });
    for (const [id, role, agentName] of [
      ['m_reviewer', 'reviewer', 'mafw-review'],
      ['m_lead', 'lead', 'manager'],
      ['m_builder', 'builder', 'mafw-execute'],
    ] as const) {
      store.upsertMember({
        id,
        podId: 'pod_1',
        role,
        displayName: role,
        agentName,
        modelProvider: null,
        modelId: null,
        status: 'available',
        configJson: null,
        now: '2026-10-29T00:00:00.000Z',
      });
    }

    expect(store.listMembers('pod_1').map((m) => m.role)).toEqual(['lead', 'builder', 'reviewer']);
    expect(store.getMemberByRole('pod_1', 'builder')?.agentName).toBe('mafw-execute');
  });

  test('getActiveGoal only returns the active goal', () => {
    store.ensurePod({ id: 'pod_1', projectDir: '/proj/a', name: 'A', now: '2026-10-29T00:00:00.000Z' });
    store.enqueueGoal({ id: 'pg_1', podId: 'pod_1', goalId: 'g1', now: '2026-10-29T00:00:00.000Z' });
    store.enqueueGoal({ id: 'pg_2', podId: 'pod_1', goalId: 'g2', now: '2026-10-29T00:01:00.000Z' });
    store.setGoalStatus('pg_1', 'active', { startedAt: '2026-10-29T00:02:00.000Z' });

    expect(store.getActiveGoal('pod_1')?.goalId).toBe('g1');
    expect(store.listGoals('pod_1')).toHaveLength(2);
  });

  test('upsertTask is idempotent by sourceKey and updateTask changes status', () => {
    store.ensurePod({ id: 'pod_1', projectDir: '/proj/a', name: 'A', now: '2026-10-29T00:00:00.000Z' });
    const first = store.upsertTask({
      id: 't1',
      podId: 'pod_1',
      goalId: 'g1',
      sourceKey: 'wave:w1:task:0',
      externalTaskId: 'w1-t1',
      title: 'do a',
      description: null,
      ownerMemberId: null,
      status: 'pending',
      dependenciesJson: null,
      artifactRefsJson: null,
      now: '2026-10-29T00:00:00.000Z',
    });
    store.upsertTask({
      id: 't2',
      podId: 'pod_1',
      goalId: 'g1',
      sourceKey: 'wave:w1:task:0',
      externalTaskId: 'w1-t1',
      title: 'do a better',
      description: 'updated',
      ownerMemberId: null,
      status: 'pending',
      dependenciesJson: null,
      artifactRefsJson: null,
      now: '2026-10-29T00:01:00.000Z',
    });

    const tasks = store.listTasks('pod_1', 'g1');
    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe(first.id);
    expect(tasks[0].title).toBe('do a better');
    expect(tasks[0].status).toBe('pending');

    store.updateTask(first.id, { status: 'in_progress' }, '2026-10-29T00:02:00.000Z');
    expect(store.getTask(first.id)?.status).toBe('in_progress');
    expect(store.getTaskBySourceKey('pod_1', 'wave:w1:task:0')?.id).toBe(first.id);
  });

  test('acceptanceJson is mirrored on upsert and refreshed without touching status', () => {
    store.ensurePod({ id: 'pod_1', projectDir: '/proj/a', name: 'A', now: '2026-10-29T00:00:00.000Z' });
    const task = store.upsertTask({
      id: 't1',
      podId: 'pod_1',
      goalId: 'g1',
      sourceKey: 'wave:w1:task:0',
      externalTaskId: 'w1-t1',
      title: 'do a',
      description: null,
      ownerMemberId: null,
      status: 'pending',
      dependenciesJson: null,
      artifactRefsJson: null,
      acceptanceJson: JSON.stringify(['旧标准']),
      now: '2026-10-29T00:00:00.000Z',
    });
    expect(task.acceptanceJson).toBe(JSON.stringify(['旧标准']));

    store.updateTask(task.id, { status: 'review' }, '2026-10-29T00:01:00.000Z');
    store.upsertTask({
      id: 't2',
      podId: 'pod_1',
      goalId: 'g1',
      sourceKey: 'wave:w1:task:0',
      externalTaskId: 'w1-t1',
      title: 'do a',
      description: null,
      ownerMemberId: null,
      status: 'pending',
      dependenciesJson: null,
      artifactRefsJson: null,
      acceptanceJson: JSON.stringify(['新标准', '另一条']),
      now: '2026-10-29T00:02:00.000Z',
    });

    const refreshed = store.getTask(task.id)!;
    expect(refreshed.acceptanceJson).toBe(JSON.stringify(['新标准', '另一条']));
    expect(refreshed.status).toBe('review');
  });

  test('messages are newest-first and markMessageRead stamps readAt', () => {
    store.ensurePod({ id: 'pod_1', projectDir: '/proj/a', name: 'A', now: '2026-10-29T00:00:00.000Z' });
    const m1 = store.insertMessage({
      id: 'msg_1',
      podId: 'pod_1',
      fromMemberId: 'm_lead',
      toMemberId: null,
      kind: 'note',
      body: 'first',
      now: '2026-10-29T00:00:00.000Z',
    });
    store.insertMessage({
      id: 'msg_2',
      podId: 'pod_1',
      fromMemberId: 'm_builder',
      toMemberId: 'm_lead',
      kind: 'request',
      body: 'second',
      now: '2026-10-29T00:01:00.000Z',
    });

    expect(store.listMessages('pod_1').map((m) => m.id)).toEqual(['msg_2', 'msg_1']);
    store.markMessageRead(m1.id, '2026-10-29T00:02:00.000Z');
    expect(store.listMessages('pod_1').find((m) => m.id === m1.id)?.readAt).toBe('2026-10-29T00:02:00.000Z');
  });

  test('session snapshots end the session and listSessionIds is distinct', () => {
    store.ensurePod({ id: 'pod_1', projectDir: '/proj/a', name: 'A', now: '2026-10-29T00:00:00.000Z' });
    store.insertSession({
      id: 'ps_1',
      podId: 'pod_1',
      memberId: 'm_builder',
      goalId: 'g1',
      node: 'execute',
      sessionId: 'ses_1',
      status: 'active',
      transcriptRef: null,
      now: '2026-10-29T00:00:00.000Z',
    });
    store.insertSession({
      id: 'ps_manager',
      podId: 'pod_1',
      memberId: 'm_lead',
      goalId: null,
      node: 'coordination',
      sessionId: 'ses_manager',
      status: 'active',
      transcriptRef: null,
      now: '2026-10-29T00:00:00.000Z',
    });
    store.insertSnapshot({
      id: 'snap_1',
      podId: 'pod_1',
      memberId: 'm_builder',
      goalId: 'g1',
      node: 'execute',
      sessionId: 'ses_1',
      path: '/tmp/ses_1.json',
      now: '2026-10-29T00:01:00.000Z',
    });
    store.endSession('ses_1', '2026-10-29T00:01:00.000Z');

    expect(store.listSessions('pod_1')).toHaveLength(2);
    expect(store.listActiveSessions('pod_1').map((s) => s.sessionId)).toEqual(['ses_manager']);
    expect(store.getSnapshot('ses_1')?.path).toBe('/tmp/ses_1.json');
    expect(store.getSnapshotForPod('pod_1', 'ses_1')?.path).toBe('/tmp/ses_1.json');
    expect(store.getSnapshotForPod('pod_2', 'ses_1')).toBeNull();
    expect(store.listSessionIds('pod_1', 0)).toEqual(['ses_1']);
  });

  test('links Pod tasks/messages to A2A ids both ways', () => {
    const now = '2026-10-30T00:00:00.000Z';
    store.ensurePod({ id: 'pod_1', projectDir: '/p', name: 'P', now });
    store.linkA2A({
      id: 'l1', podId: 'pod_1', localKind: 'task', localId: 'pt1',
      a2aId: 'a2a_1', contextId: 'pod:pod_1:goal:g1', now,
    });
    expect(store.getA2ALink('pod_1', 'task', 'pt1')?.a2aId).toBe('a2a_1');
    expect(store.getA2ALocalId('pod_1', 'task', 'a2a_1')).toBe('pt1');
    expect(store.listA2ALinks('pod_1', 'task')).toHaveLength(1);
    expect(store.getA2ALink('pod_1', 'message', 'pt1')).toBeNull();
  });

  test('stores A2A message fields and enforces external message id uniqueness', () => {
    const now = '2026-10-30T00:00:00.000Z';
    store.ensurePod({ id: 'pod_1', projectDir: '/p', name: 'P', now });
    store.insertMessage({
      id: 'm1', podId: 'pod_1', fromMemberId: 'm_lead', toMemberId: 'm_builder',
      kind: 'request', body: 'do', protocol: 'a2a', externalMessageId: 'a2a_m1',
      partsJson: '[]', now,
    });
    const [message] = store.listMessages('pod_1');
    expect(message).toMatchObject({
      protocol: 'a2a',
      externalMessageId: 'a2a_m1',
      deliveredAt: null,
      deliveredSessionId: null,
    });
    expect(() => store.insertMessage({
      id: 'm2', podId: 'pod_1', fromMemberId: 'm_lead', toMemberId: 'm_builder',
      kind: 'request', body: 'again', protocol: 'a2a', externalMessageId: 'a2a_m1',
      now,
    })).toThrow();
  });

  test('migrates an existing pod_messages table without A2A columns', () => {
    const oldDb = new Database(path.join(dir, 'old.db'));
    oldDb.exec(`
      CREATE TABLE pod_messages (
        id TEXT PRIMARY KEY,
        pod_id TEXT NOT NULL,
        from_member_id TEXT NOT NULL,
        to_member_id TEXT,
        kind TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL,
        read_at TEXT
      );
    `);
    const migrated = new PodStore(oldDb);
    const cols = (oldDb.prepare('PRAGMA table_info(pod_messages)').all() as any[]).map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(['protocol', 'external_message_id', 'delivered_at']));
    expect(migrated.listMessages('p')).toEqual([]);
    oldDb.close();
  });

  test('legacy delivered broadcast does not replay after migration', () => {
    const now = '2026-10-30T00:00:00.000Z';
    store.ensurePod({ id: 'pod_1', projectDir: '/p', name: 'P', now });
    const builder = store.upsertMember({
      id: 'm_builder', podId: 'pod_1', role: 'builder', displayName: 'B', agentName: 'mafw-execute',
      modelProvider: null, modelId: null, status: 'available', configJson: null, now,
    });
    const reviewer = store.upsertMember({
      id: 'm_reviewer', podId: 'pod_1', role: 'reviewer', displayName: 'R', agentName: 'mafw-review',
      modelProvider: null, modelId: null, status: 'available', configJson: null, now,
    });
    store.insertSession({
      id: 'ps1', podId: 'pod_1', memberId: builder.id, goalId: null, node: 'execute',
      sessionId: 'ses_builder', status: 'active', transcriptRef: null, now,
    });
    const msg = store.insertMessage({
      id: 'm1', podId: 'pod_1', fromMemberId: 'm_builder', toMemberId: null,
      kind: 'note', body: 'legacy', protocol: null, externalMessageId: null, now,
    });
    db.prepare('UPDATE pod_messages SET delivered_at = ?, delivered_session_id = ? WHERE id = ?')
      .run(now, 'ses_builder', msg.id);

    // Opening the store runs the additive delivery migration.
    const reopened = new PodStore(db);
    expect(reopened.listPendingMessages('pod_1', reviewer.id)).toEqual([]);
    expect(reopened.listDeliveryFailures('pod_1')).toEqual([]);
  });

  test('goal worktree insert is idempotent and readable by revision', () => {
    const first = store.insertGoalWorktree({
      podId: 'pod_1',
      goalId: 'g1',
      revision: 1,
      dir: '/tmp/repo-wt-g1-r1',
      branch: 'mafw/g1-r1',
      baseRef: 'main',
      baseBranch: 'main',
      status: 'active',
      now: '2026-11-09T00:00:00.000Z',
    });
    const duplicate = store.insertGoalWorktree({
      podId: 'pod_1',
      goalId: 'g1',
      revision: 1,
      dir: '/tmp/other',
      branch: 'mafw/other',
      baseRef: 'HEAD',
      baseBranch: null,
      status: 'missing',
      now: '2026-11-09T00:01:00.000Z',
    });

    expect(duplicate.dir).toBe(first.dir);
    expect(duplicate.dir).toBe('/tmp/repo-wt-g1-r1');
    expect(store.getGoalWorktree('pod_1', 'g1', 1)).toMatchObject({
      podId: 'pod_1',
      goalId: 'g1',
      revision: 1,
      branch: 'mafw/g1-r1',
      baseRef: 'main',
      baseBranch: 'main',
      status: 'active',
      mergeCommit: null,
      mergedAt: null,
    });
    expect(store.getGoalWorktree('pod_1', 'g1', 2)).toBeNull();
  });

  test('goal worktree update records merge state and returns null for missing rows', () => {
    store.insertGoalWorktree({
      podId: 'pod_1',
      goalId: 'g1',
      revision: 1,
      dir: '/tmp/repo-wt-g1-r1',
      branch: 'mafw/g1-r1',
      baseRef: 'main',
      baseBranch: 'main',
      status: 'active',
      now: '2026-11-09T00:00:00.000Z',
    });

    const updated = store.updateGoalWorktree({
      podId: 'pod_1',
      goalId: 'g1',
      revision: 1,
      status: 'merged',
      mergeCommit: 'abc123',
      mergedAt: '2026-11-09T01:00:00.000Z',
      now: '2026-11-09T01:00:00.000Z',
    });

    expect(updated).toMatchObject({
      status: 'merged',
      mergeCommit: 'abc123',
      mergedAt: '2026-11-09T01:00:00.000Z',
      updatedAt: '2026-11-09T01:00:00.000Z',
    });
    expect(store.updateGoalWorktree({
      podId: 'pod_1',
      goalId: 'missing',
      revision: 1,
      status: 'merged',
      now: '2026-11-09T01:00:00.000Z',
    })).toBeNull();
  });

  test('migrates pod_member_sessions with a runtime column and tags legacy rows opencode', () => {
    const oldDb = new Database(path.join(dir, 'old-session-runtime.db'));
    oldDb.exec(`
      CREATE TABLE pod_member_sessions (
        id TEXT PRIMARY KEY,
        pod_id TEXT NOT NULL,
        member_id TEXT NOT NULL,
        goal_id TEXT,
        node TEXT,
        session_id TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL,
        transcript_ref TEXT,
        scope_kind TEXT,
        revision INTEGER,
        generation INTEGER NOT NULL DEFAULT 1,
        last_active_at TEXT,
        created_at TEXT NOT NULL,
        ended_at TEXT
      );
    `);
    oldDb.prepare(`
      INSERT INTO pod_member_sessions (id, pod_id, member_id, session_id, status, created_at)
      VALUES ('ps_old', 'pod_1', 'm_lead', 'ses_legacy', 'active', '2026-10-01T00:00:00.000Z')
    `).run();

    const migrated = new PodStore(oldDb);
    const cols = (oldDb.prepare('PRAGMA table_info(pod_member_sessions)').all() as any[]).map((c) => c.name);
    expect(cols).toContain('runtime');
    expect(migrated.getSessionBySessionId('ses_legacy')?.runtime).toBe('opencode');
    oldDb.close();
  });

  test('persists session runtime and filters active sessions/leases by runtime', () => {
    const now = '2026-11-09T00:00:00.000Z';
    store.insertSession({
      id: 'ps_oc', podId: 'pod_1', memberId: 'm_lead', goalId: null, node: 'coordination',
      sessionId: 'ses_oc', status: 'active', transcriptRef: null, runtime: 'opencode', now,
    });
    store.insertSession({
      id: 'ps_pi', podId: 'pod_1', memberId: 'm_lead', goalId: null, node: 'coordination',
      sessionId: 'ses_pi', status: 'active', transcriptRef: null, runtime: 'pi', now,
    });
    expect(store.getSessionBySessionId('ses_pi')?.runtime).toBe('pi');
    expect(store.listActiveSessions('pod_1', 'opencode').map((s) => s.sessionId)).toEqual(['ses_oc']);
    expect(store.listActiveSessions('pod_1', 'pi').map((s) => s.sessionId)).toEqual(['ses_pi']);

    const scope = { podId: 'pod_1', memberId: 'm_builder', goalId: 'g1', revision: 1, kind: 'discussion' as const };
    store.leaseScopedSession({ id: 'ls_oc', scope, sessionId: 'ses_scoped_oc', runtime: 'opencode', now });
    expect(store.getActiveScopedSession(scope, 'opencode')?.sessionId).toBe('ses_scoped_oc');
    expect(store.getActiveScopedSession(scope, 'pi')).toBeNull();

    // A runtime switch retires the previous runtime's lease for that scope
    // (Option 1: one active lease line; old runtime rows stay as history).
    store.leaseScopedSession({ id: 'ls_pi', scope, sessionId: 'ses_scoped_pi', runtime: 'pi', now });
    expect(store.getActiveScopedSession(scope, 'pi')?.sessionId).toBe('ses_scoped_pi');
    expect(store.getActiveScopedSession(scope, 'opencode')).toBeNull();
    expect(store.getSessionBySessionId('ses_scoped_oc')?.endedAt).not.toBeNull();
  });

  test('getMemberBySession only resolves sessions owned by the requested runtime', () => {
    const now = '2026-11-09T00:00:00.000Z';
    store.ensurePod({ id: 'pod_1', projectDir: '/p', name: 'P', now });
    store.upsertMember({
      id: 'm_lead', podId: 'pod_1', role: 'lead', displayName: 'Lead', agentName: 'lead',
      modelProvider: null, modelId: null, status: 'available', configJson: null, now,
    });
    store.insertSession({
      id: 'ps_pi_lead', podId: 'pod_1', memberId: 'm_lead', goalId: null, node: 'coordination',
      sessionId: 'ses_pi_lead', status: 'active', transcriptRef: null, runtime: 'pi', now,
    });

    expect((store.getMemberBySession as any)('ses_pi_lead', 'opencode')).toBeNull();
    expect((store.getMemberBySession as any)('ses_pi_lead', 'pi')?.id).toBe('m_lead');
  });
});
