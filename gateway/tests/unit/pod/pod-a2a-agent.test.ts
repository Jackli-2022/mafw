import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Task } from '@a2a-js/sdk';
import { TaskState } from '@a2a-js/sdk';
import { PodA2AAgent } from '../../../src/core/pod/pod-a2a-agent';
import { buildA2AMessage, buildA2ATask } from '../../../src/core/pod/pod-a2a-mapping';
import type { PodTaskRow } from '../../../src/core/pod/pod-store';

const NOW = '2026-10-30T00:00:00.000Z';
const taskRow: PodTaskRow = {
  id: 't1', podId: 'pod_1', goalId: 'g1', sourceKey: 'a2a:msg_1', externalTaskId: null,
  title: 'T', description: 'out', ownerMemberId: 'm_builder', status: 'pending',
  dependenciesJson: null, artifactRefsJson: null, createdAt: NOW, updatedAt: NOW,
};

function makeAgent() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-pod-artifacts-'));
  fs.writeFileSync(path.join(root, 'a.md'), '# artifact');
  const task = buildA2ATask({ task: taskRow }) as Task;
  const bridge = {
    sendMessage: jest.fn(async () => task),
    getTask: jest.fn(() => task),
    cancelTask: jest.fn(() => ({ ...task, status: { state: TaskState.TASK_STATE_CANCELED, timestamp: NOW } })),
  };
  const agent = new PodA2AAgent({
    bridge: bridge as any,
    podId: 'pod_1',
    podName: 'P',
    baseUrl: 'http://127.0.0.1:3000',
    artifactRoot: root,
  });
  return { agent, bridge, root, task };
}

const rpc = (method: string, params: unknown) => JSON.stringify({ jsonrpc: '2.0', id: '1', method, params });

describe('PodA2AAgent', () => {
  test('agent card advertises handoff and the Pod endpoint', () => {
    const { agent, root } = makeAgent();
    expect(agent.agentCard.name).toContain('pod_1');
    expect(agent.agentCard.url).toBe('http://127.0.0.1:3000/a2a/pods/pod_1');
    expect(agent.agentCard.skills?.map((skill) => skill.id)).toContain('pod.handoff');
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('message/send returns a task and tasks/get round-trips', async () => {
    const { agent, bridge, task, root } = makeAgent();
    const message = buildA2AMessage({
      messageId: 'msg_1',
      contextId: 'pod:pod_1:goal:g1',
      text: 'do it',
      data: { kind: 'request', taskId: 't1', goalId: 'g1' },
      metadata: { podId: 'pod_1', fromMemberId: 'm_lead', toMemberId: 'm_builder' },
    });
    const sent = await agent.handleJsonRpc(rpc('message/send', { message }), { 'a2a-version': '1.0' });
    expect(sent.status).toBe(200);
    const sentResult = JSON.parse(sent.body).result;
    expect((sentResult.task ?? sentResult).id).toBe('t1');
    expect(bridge.sendMessage).toHaveBeenCalled();

    const got = await agent.handleJsonRpc(rpc('tasks/get', { id: 't1' }), { 'a2a-version': '1.0' });
    const gotResult = JSON.parse(got.body).result;
    expect((gotResult.task ?? gotResult).id).toBe(task.id);
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('artifact lookup rejects traversal and serves files inside the root', () => {
    const { agent, root } = makeAgent();
    expect(agent.getArtifact('a.md')?.contentType).toContain('text/markdown');
    expect(agent.getArtifact('../a.md')).toBeNull();
    expect(agent.getArtifact('..%2Fa.md')).toBeNull();
    expect(agent.getArtifact('/etc/passwd')).toBeNull();
    fs.rmSync(root, { recursive: true, force: true });
  });
});
