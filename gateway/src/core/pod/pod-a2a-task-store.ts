import type { Task } from '@a2a-js/sdk';
import { TaskState } from '@a2a-js/sdk';
import type { ListTasksRequest, ListTasksResponse } from '@a2a-js/sdk';
import type { ServerCallContext, TaskStore } from '@a2a-js/sdk/server';
import type { PodA2ABridge } from './pod-a2a-bridge';

/**
 * A2A TaskStore adapter. Pod task is authoritative; save/load are projections.
 * Mutations must go through PodA2ABridge, never through the A2A store.
 */
export class PodA2ATaskStore implements TaskStore {
  constructor(private readonly deps: { bridge: PodA2ABridge; podId: string }) {}

  async save(task: Task, _context: ServerCallContext): Promise<void> {
    if (task.status?.state === TaskState.TASK_STATE_CANCELED) {
      this.deps.bridge.cancelTask(this.deps.podId, task.id);
    }
  }

  async load(taskId: string, _context: ServerCallContext): Promise<Task | undefined> {
    return this.deps.bridge.getTask(this.deps.podId, taskId) ?? undefined;
  }

  async list(params: ListTasksRequest, _context: ServerCallContext): Promise<ListTasksResponse> {
    return { tasks: this.deps.bridge.listTasks(this.deps.podId, params?.contextId ?? null) } as unknown as ListTasksResponse;
  }
}
