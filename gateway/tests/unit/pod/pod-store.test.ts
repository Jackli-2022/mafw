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

  test('marks a message delivered to one session', () => {
    const now = '2026-10-30T00:00:00.000Z';
    store.ensurePod({ id: 'pod_1', projectDir: '/p', name: 'P', now });
    store.insertMessage({
      id: 'm1', podId: 'pod_1', fromMemberId: 'm_lead', toMemberId: 'm_builder',
      kind: 'request', body: 'do', now,
    });
    store.markMessageDelivered('m1', 'ses_builder', now);
    expect(store.listMessages('pod_1')[0].deliveredAt).toBe(now);
    expect(store.listMessages('pod_1')[0].deliveredSessionId).toBe('ses_builder');
  });
});
