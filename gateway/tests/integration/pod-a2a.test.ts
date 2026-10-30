import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TaskState } from '@a2a-js/sdk';
import { PodAccess } from '../../src/core/pod/pod-access';
import { buildA2AMessage } from '../../src/core/pod/pod-a2a-mapping';
import { PodA2AAgent } from '../../src/core/pod/pod-a2a-agent';
import { PodA2ABridge } from '../../src/core/pod/pod-a2a-bridge';
import { PodMessageDelivery } from '../../src/core/pod/pod-message-delivery';
import { PodStore } from '../../src/core/pod/pod-store';

const NOW = '2026-10-30T00:00:00.000Z';

test('A2A handoff end-to-end: create, deliver, pull, cancel', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-pod-a2a-e2e-'));
  const db = new Database(path.join(dir, 'test.db'));
  const store = new PodStore(db);
  let seq = 0;
  const newId = () => `id_${++seq}`;
  const pod = store.ensurePod({ id: 'pod_1', projectDir: '/p1', name: 'P1', now: NOW });
  const lead = store.upsertMember({ id: 'm_lead', podId: pod.id, role: 'lead', displayName: 'Lead', agentName: 'manager', modelProvider: null, modelId: null, status: 'available', configJson: null, now: NOW });
  const builder = store.upsertMember({ id: 'm_builder', podId: pod.id, role: 'builder', displayName: 'Builder', agentName: 'mafw-execute', modelProvider: null, modelId: null, status: 'available', configJson: null, now: NOW });
  store.upsertMember({ id: 'm_reviewer', podId: pod.id, role: 'reviewer', displayName: 'Reviewer', agentName: 'mafw-review', modelProvider: null, modelId: null, status: 'available', configJson: null, now: NOW });
  store.insertSession({ id: 'ps1', podId: pod.id, memberId: builder.id, goalId: 'g1', node: 'coordination', sessionId: 'ses_builder', status: 'active', transcriptRef: null, now: NOW });

  const notify = () => {};
  const access = new PodAccess(store);
  const prompts: any[] = [];
  const delivery = new PodMessageDelivery({
    store,
    getSession: async () => ({}),
    promptAsync: async (input) => { prompts.push(input); },
  });
  const bridge = new PodA2ABridge({ store, access, delivery, now: () => NOW, newId, notify });

  const message = buildA2AMessage({
    messageId: 'msg_e2e',
    contextId: 'pod:pod_1:goal:g1',
    text: 'implement rate limit',
    data: { kind: 'request', taskId: 't1', goalId: 'g1', title: 'Rate limit', expectedOutput: 'tests pass', acceptance: ['npm test'] },
    metadata: { podId: 'pod_1', fromMemberId: lead.id, toMemberId: builder.id },
  });

  const task = await bridge.sendMessage(pod.id, message);
  expect((task as any).status.state).toBe(TaskState.TASK_STATE_SUBMITTED);
  expect(store.getTask('t1')).toMatchObject({ status: 'pending', ownerMemberId: builder.id });
  expect(store.listMessages(pod.id)).toHaveLength(1);
  expect(store.getA2ALink(pod.id, 'task', 't1')?.a2aId).toBe('t1');
  expect(store.getA2ALink(pod.id, 'message', store.listMessages(pod.id)[0].id)?.a2aId).toBe('msg_e2e');
  expect(prompts).toHaveLength(1);
  expect(prompts[0].message).toContain('[POD HANDOFF]');

  const duplicate = await bridge.sendMessage(pod.id, message);
  expect((duplicate as any).id).toBe('t1');
  expect(store.listMessages(pod.id)).toHaveLength(1);

  store.updateTask('t1', { status: 'in_progress' }, NOW);
  expect((bridge.getTask(pod.id, 't1') as any).status.state).toBe(TaskState.TASK_STATE_WORKING);

  expect((bridge.cancelTask(pod.id, 't1') as any).status.state).toBe(TaskState.TASK_STATE_CANCELED);
  expect(store.getTask('t1')?.status).toBe('failed');
  expect((bridge.getTask(pod.id, 't1') as any).status.state).toBe(TaskState.TASK_STATE_CANCELED);

  const agent = new PodA2AAgent({
    bridge,
    podId: pod.id,
    podName: pod.name,
    baseUrl: 'http://127.0.0.1:3000',
    artifactRoot: path.join(dir, 'artifacts'),
  });
  const wireMessage = {
    role: 1,
    messageId: 'msg_wire',
    contextId: 'pod:pod_1',
    taskId: '',
    parts: [
      { text: 'wire handoff', metadata: {}, filename: '', mediaType: 'text/plain' },
      { data: { kind: 'request', taskId: 't2', goalId: 'g2', title: 'Wire' }, metadata: {}, filename: '', mediaType: 'application/json' },
    ],
    metadata: { podId: pod.id, fromMemberId: lead.id, toMemberId: builder.id },
    extensions: [],
    referenceTaskIds: [],
  };
  const sent = await agent.handleJsonRpc(JSON.stringify({
    jsonrpc: '2.0', id: '1', method: 'message/send', params: { message: wireMessage },
  }), { 'a2a-version': '1.0' });
  const sentResult = JSON.parse(sent.body).result;
  expect((sentResult.task ?? sentResult).id).toBe('t2');
  expect(store.getTask('t2')).toMatchObject({ status: 'pending', title: 'Wire' });
  expect(store.listMessages(pod.id).find((item) => item.externalMessageId === 'msg_wire')?.body).toBe('wire handoff');

  const canceled = await agent.handleJsonRpc(JSON.stringify({
    jsonrpc: '2.0', id: '2', method: 'tasks/cancel', params: { id: 't2' },
  }), { 'a2a-version': '1.0' });
  const canceledResult = JSON.parse(canceled.body).result;
  expect((canceledResult.task ?? canceledResult).status.state).toBe('TASK_STATE_CANCELED');

  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

