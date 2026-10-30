import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TaskState } from '@a2a-js/sdk';
import { PodAccess } from '../../src/core/pod/pod-access';
import { buildA2AMessage } from '../../src/core/pod/pod-a2a-mapping';
import { PodA2ABridge } from '../../src/core/pod/pod-a2a-bridge';
import { PodMessageDelivery } from '../../src/core/pod/pod-message-delivery';
import { PodMessageService } from '../../src/core/pod/pod-message-service';
import { PodStore } from '../../src/core/pod/pod-store';
import { PodTaskService } from '../../src/core/pod/pod-task-service';

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
  const tasks = new PodTaskService({ store, now: () => NOW, newId, notify });
  const messages = new PodMessageService({ store, now: () => NOW, newId, notify });
  const access = new PodAccess(store);
  const prompts: any[] = [];
  const delivery = new PodMessageDelivery({
    store,
    getSession: async () => ({}),
    promptAsync: async (input) => { prompts.push(input); },
  });
  const bridge = new PodA2ABridge({ store, tasks, messages, access, delivery, now: () => NOW, newId, notify });

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

  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
