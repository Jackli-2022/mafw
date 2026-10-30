import type { Message, Part, Task } from '@a2a-js/sdk';
import { TaskState } from '@a2a-js/sdk';
import { PodError, type PodTaskRow, type PodTaskStatus } from './pod-store';

export interface PodHandoffInput {
  kind: 'request' | 'review' | 'decision' | 'escalation' | 'note';
  fromMemberId: string | null;
  toMemberId: string | null;
  podTaskId: string | null;
  goalId: string | null;
  title: string | null;
  expectedOutput: string | null;
  contextRefs: string[];
  artifactRefs: string[];
  acceptance: string[];
  body: string;
  messageId: string;
  contextId: string | null;
}

const KINDS = new Set(['request', 'review', 'decision', 'escalation', 'note']);

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

export function parseHandoffMessage(message: Message): PodHandoffInput {
  let body = '';
  let data: Record<string, unknown> = {};

  for (const part of message.parts ?? []) {
    const content = (part as Part).content;
    if (content?.$case === 'text') {
      body += content.value;
      continue;
    }
    if (content?.$case === 'data') {
      if (!content.value || typeof content.value !== 'object' || Array.isArray(content.value)) {
        throw new PodError(400, 'invalid handoff data');
      }
      data = content.value as Record<string, unknown>;
    }
  }

  const metadata = (message.metadata ?? {}) as Record<string, unknown>;
  const rawKind = stringOrNull(data.kind) ?? 'note';
  const kind = KINDS.has(rawKind) ? rawKind as PodHandoffInput['kind'] : 'note';

  return {
    kind,
    fromMemberId: stringOrNull(metadata.fromMemberId) ?? stringOrNull(data.fromMemberId),
    toMemberId: stringOrNull(metadata.toMemberId) ?? stringOrNull(data.toMemberId),
    podTaskId: stringOrNull(data.taskId) ?? stringOrNull(data.podTaskId),
    goalId: stringOrNull(data.goalId),
    title: stringOrNull(data.title),
    expectedOutput: stringOrNull(data.expectedOutput),
    contextRefs: stringArray(data.contextRefs),
    artifactRefs: stringArray(data.artifactRefs),
    acceptance: stringArray(data.acceptance),
    body: body.trim(),
    messageId: message.messageId,
    contextId: message.contextId ?? null,
  };
}

export function a2aStateForPodStatus(status: PodTaskStatus): TaskState {
  switch (status) {
    case 'pending':
      return TaskState.TASK_STATE_SUBMITTED;
    case 'in_progress':
    case 'review':
    case 'reopened':
      return TaskState.TASK_STATE_WORKING;
    case 'blocked':
      return TaskState.TASK_STATE_INPUT_REQUIRED;
    case 'done':
      return TaskState.TASK_STATE_COMPLETED;
    case 'failed':
      return TaskState.TASK_STATE_FAILED;
  }
  return TaskState.TASK_STATE_WORKING;
}

export function podStatusForA2AState(state: TaskState): PodTaskStatus {
  switch (state) {
    case TaskState.TASK_STATE_SUBMITTED:
      return 'pending';
    case TaskState.TASK_STATE_COMPLETED:
      return 'done';
    case TaskState.TASK_STATE_FAILED:
    case TaskState.TASK_STATE_CANCELED:
    case TaskState.TASK_STATE_REJECTED:
      return 'failed';
    case TaskState.TASK_STATE_INPUT_REQUIRED:
    case TaskState.TASK_STATE_AUTH_REQUIRED:
      return 'blocked';
    case TaskState.TASK_STATE_WORKING:
    case TaskState.TASK_STATE_UNSPECIFIED:
      return 'in_progress';
  }
  return 'in_progress';
}

export function buildA2AMessage(input: {
  messageId: string;
  contextId: string;
  text: string;
  data?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}): Message {
  const parts: Part[] = [
    {
      content: { $case: 'text', value: input.text },
      metadata: {},
      filename: '',
      mediaType: 'text/plain',
    } as Part,
  ];
  if (input.data) {
    parts.push({
      content: { $case: 'data', value: input.data },
      metadata: {},
      filename: '',
      mediaType: 'application/json',
    } as Part);
  }
  return {
    role: 1,
    messageId: input.messageId,
    contextId: input.contextId,
    taskId: '',
    parts,
    metadata: input.metadata ?? {},
    extensions: [],
    referenceTaskIds: [],
  } as Message;
}

export function buildA2ATask(input: {
  task: PodTaskRow;
  podStatus?: string;
  state?: TaskState;
  artifacts?: { artifactId: string; name?: string; parts: Part[] }[];
}): Task {
  const { task } = input;
  const contextId = task.goalId ? `pod:${task.podId}:goal:${task.goalId}` : `pod:${task.podId}`;
  return {
    id: task.id,
    contextId,
    status: {
      state: input.state ?? a2aStateForPodStatus(task.status),
      timestamp: task.updatedAt,
    },
    history: [],
    artifacts: input.artifacts ?? [],
    metadata: {
      podId: task.podId,
      podStatus: input.podStatus ?? task.status,
      goalId: task.goalId,
      ownerMemberId: task.ownerMemberId,
    },
  } as unknown as Task;
}
