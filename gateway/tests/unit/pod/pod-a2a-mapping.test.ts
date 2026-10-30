import { TaskState } from '@a2a-js/sdk';
import {
  a2aStateForPodStatus,
  buildA2AMessage,
  buildA2ATask,
  parseHandoffMessage,
  podStatusForA2AState,
} from '../../../src/core/pod/pod-a2a-mapping';
import type { PodTaskRow } from '../../../src/core/pod/pod-store';

const task = (patch: Partial<PodTaskRow> = {}): PodTaskRow => ({
  id: 'pt1',
  podId: 'pod_1',
  goalId: 'g1',
  sourceKey: 'manual:pt1',
  externalTaskId: null,
  title: 'T',
  description: null,
  ownerMemberId: 'm_builder',
  status: 'pending',
  dependenciesJson: null,
  artifactRefsJson: null,
  createdAt: '2026-10-30T00:00:00.000Z',
  updatedAt: '2026-10-30T00:00:00.000Z',
  ...patch,
});

describe('Pod A2A mapping', () => {
  test('parses text + data + metadata into a handoff', () => {
    const message = buildA2AMessage({
      messageId: 'msg_1',
      contextId: 'pod:pod_1:goal:g1',
      text: 'do it',
      data: {
        kind: 'request',
        taskId: 'pt1',
        goalId: 'g1',
        title: 'T',
        expectedOutput: 'out',
        contextRefs: ['a.md'],
        artifactRefs: ['art_1'],
        acceptance: ['test'],
      },
      metadata: { fromMemberId: 'm_lead', toMemberId: 'm_builder' },
    });

    expect(parseHandoffMessage(message)).toEqual({
      kind: 'request',
      fromMemberId: 'm_lead',
      toMemberId: 'm_builder',
      podTaskId: 'pt1',
      goalId: 'g1',
      title: 'T',
      expectedOutput: 'out',
      contextRefs: ['a.md'],
      artifactRefs: ['art_1'],
      acceptance: ['test'],
      body: 'do it',
      messageId: 'msg_1',
      contextId: 'pod:pod_1:goal:g1',
    });
  });

  test('defaults unknown/missing data and rejects non-object data', () => {
    const message = buildA2AMessage({ messageId: 'm2', contextId: 'c', text: 'note' });
    expect(parseHandoffMessage(message)).toMatchObject({ kind: 'note', fromMemberId: null, toMemberId: null, body: 'note' });

    const bad = buildA2AMessage({ messageId: 'm3', contextId: 'c', text: 'x' });
    bad.parts.push({ content: { $case: 'data', value: 'not-an-object' }, metadata: {}, filename: '', mediaType: 'application/json' } as any);
    expect(() => parseHandoffMessage(bad)).toThrow(/invalid handoff data/i);
  });

  test('maps Pod status to A2A state and back', () => {
    expect(a2aStateForPodStatus('pending')).toBe(TaskState.TASK_STATE_SUBMITTED);
    expect(a2aStateForPodStatus('in_progress')).toBe(TaskState.TASK_STATE_WORKING);
    expect(a2aStateForPodStatus('blocked')).toBe(TaskState.TASK_STATE_INPUT_REQUIRED);
    expect(a2aStateForPodStatus('review')).toBe(TaskState.TASK_STATE_WORKING);
    expect(a2aStateForPodStatus('done')).toBe(TaskState.TASK_STATE_COMPLETED);
    expect(a2aStateForPodStatus('failed')).toBe(TaskState.TASK_STATE_FAILED);
    expect(a2aStateForPodStatus('reopened')).toBe(TaskState.TASK_STATE_WORKING);

    expect(podStatusForA2AState(TaskState.TASK_STATE_SUBMITTED)).toBe('pending');
    expect(podStatusForA2AState(TaskState.TASK_STATE_WORKING)).toBe('in_progress');
    expect(podStatusForA2AState(TaskState.TASK_STATE_INPUT_REQUIRED)).toBe('blocked');
    expect(podStatusForA2AState(TaskState.TASK_STATE_COMPLETED)).toBe('done');
    expect(podStatusForA2AState(TaskState.TASK_STATE_CANCELED)).toBe('failed');
    expect(podStatusForA2AState(TaskState.TASK_STATE_REJECTED)).toBe('failed');
  });

  test('builds an A2A task with pod status metadata', () => {
    const built = buildA2ATask({ task: task({ status: 'review' }), artifacts: [] });
    expect(built.id).toBe('pt1');
    expect(built.contextId).toBe('pod:pod_1:goal:g1');
    expect(built.status?.state).toBe(TaskState.TASK_STATE_WORKING);
    expect(built.metadata?.podStatus).toBe('review');
    expect(built.artifacts).toEqual([]);
  });
});
