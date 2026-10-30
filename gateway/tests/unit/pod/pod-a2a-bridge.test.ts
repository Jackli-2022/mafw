import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TaskState } from '@a2a-js/sdk';
import { PodAccess } from '../../../src/core/pod/pod-access';
import { buildA2AMessage } from '../../../src/core/pod/pod-a2a-mapping';
import { PodA2ABridge } from '../../../src/core/pod/pod-a2a-bridge';
import { PodA2ATaskStore } from '../../../src/core/pod/pod-a2a-task-store';
import { PodStore } from '../../../src/core/pod/pod-store';

const NOW = '2026-10-30T00:00:00.000Z';

function makeBridge() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-pod-a2a-'));
  const db = new Database(path.join(dir, 'test.db'));
  const store = new PodStore(db);
  let seq = 0;
  const pod = store.ensurePod({ id: 'pod_1', projectDir: '/p1', name: 'P1', now: NOW });
  const members = [
    store.upsertMember({ id: 'm_lead', podId: pod.id, role: 'lead', displayName: 'Lead', agentName: 'manager', modelProvider: null, modelId: null, status: 'available', configJson: null, now: NOW }),
    store.upsertMember({ id: 'm_builder', podId: pod.id, role: 'builder', displayName: 'Builder', agentName: 'mafw-execute', modelProvider: null, modelId: null, status: 'available', configJson: null, now: NOW }),
  ];
  const otherPod = store.ensurePod({ id: 'pod_2', projectDir: '/p2', name: 'P2', now: NOW });
  store.upsertMember({ id: 'm_other', podId: otherPod.id, role: 'lead', displayName: 'Other', agentName: 'manager', modelProvider: null, modelId: null, status: 'available', configJson: null, now: NOW });

  const notify = () => {};
  const access = new PodAccess(store);
  const bridge = new PodA2ABridge({
    store, access, now: () => NOW, newId: () => `id_${++seq}`, notify,
  });

  return { dir, db, store, pod, otherPod, lead: members[0], builder: members[1], bridge };
}

function handoffMessage(overrides: { to?: string; from?: string; taskId?: string; podId?: string } = {}) {
  return buildA2AMessage({
    messageId: 'msg_1',
    contextId: 'pod:pod_1:goal:g1',
    text: 'do it',
    data: {
      kind: 'request',
      taskId: overrides.taskId ?? 't1',
      goalId: 'g1',
      title: 'T',
      expectedOutput: 'out',
      acceptance: ['test'],
    },
    metadata: {
      podId: overrides.podId ?? 'pod_1',
      fromMemberId: overrides.from ?? 'm_lead',
      toMemberId: overrides.to ?? 'm_builder',
    },
  });
}

describe('PodA2ABridge', () => {
  test('message/send creates a Pod task, link, and message', async () => {
    const h = makeBridge();
    const task = await h.bridge.sendMessage(h.pod.id, handoffMessage());
    expect(task).toMatchObject({ id: 't1', status: { state: TaskState.TASK_STATE_SUBMITTED } });
    expect(h.store.getTask('t1')).toMatchObject({ title: 'T', status: 'pending', goalId: 'g1' });
    const messages = h.store.listMessages(h.pod.id);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ protocol: 'a2a', externalMessageId: 'msg_1' });
    expect(h.store.getA2ALink(h.pod.id, 'task', 't1')?.a2aId).toBe('t1');
    h.db.close();
    fs.rmSync(h.dir, { recursive: true, force: true });
  });

  test('repeated messageId is idempotent', async () => {
    const h = makeBridge();
    const first = await h.bridge.sendMessage(h.pod.id, handoffMessage());
    const second = await h.bridge.sendMessage(h.pod.id, handoffMessage());
    expect(second.id).toBe(first.id);
    expect(h.store.listMessages(h.pod.id)).toHaveLength(1);
    h.db.close();
    fs.rmSync(h.dir, { recursive: true, force: true });
  });

  test('getTask maps Pod status; cancel updates the Pod task', async () => {
    const h = makeBridge();
    const task = await h.bridge.sendMessage(h.pod.id, handoffMessage());
    h.store.updateTask('t1', { status: 'in_progress' }, NOW);
    expect(h.bridge.getTask(h.pod.id, task.id)?.status?.state).toBe(TaskState.TASK_STATE_WORKING);
    expect(h.bridge.cancelTask(h.pod.id, task.id)?.status?.state).toBe(TaskState.TASK_STATE_CANCELED);
    expect(h.store.getTask('t1')?.status).toBe('failed');
    h.db.close();
    fs.rmSync(h.dir, { recursive: true, force: true });
  });

  test('A2A task store loads the Pod projection and ignores saves', async () => {
    const h = makeBridge();
    await h.bridge.sendMessage(h.pod.id, handoffMessage());
    const adapters = new PodA2ATaskStore({ bridge: h.bridge, podId: h.pod.id });
    expect((await adapters.load('t1', {} as any))?.id).toBe('t1');
    await adapters.save({ id: 't1', contextId: 'x' } as any, {} as any);
    expect(h.store.getTask('t1')?.status).toBe('pending');
    h.db.close();
    fs.rmSync(h.dir, { recursive: true, force: true });
  });

  test('rejects cross-pod metadata and unknown recipient', async () => {
    const h = makeBridge();
    h.store.upsertTask({
      id: 'foreign', podId: h.otherPod.id, goalId: null, sourceKey: 'manual:foreign',
      externalTaskId: null, title: 'foreign', description: null, ownerMemberId: null,
      status: 'pending', dependenciesJson: null, artifactRefsJson: null, now: NOW,
    });
    await expect(h.bridge.sendMessage(h.pod.id, handoffMessage({ podId: 'pod_2' }))).rejects.toMatchObject({ status: 403 });
    await expect(h.bridge.sendMessage(h.pod.id, handoffMessage({ taskId: 'foreign' }))).rejects.toMatchObject({ status: 403 });
    await expect(h.bridge.sendMessage(h.pod.id, handoffMessage({ to: 'nope' }))).rejects.toMatchObject({ status: 400 });
    h.db.close();
    fs.rmSync(h.dir, { recursive: true, force: true });
  });
});

