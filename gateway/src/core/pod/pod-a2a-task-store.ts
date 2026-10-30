import type { Task } from '@a2a-js/sdk';
import type { ListTasksRequest, ListTasksResponse } from '@a2a-js/sdk';
import type { ServerCallContext, TaskStore } from '@a2a-js/sdk/server';
import type { PodA2ABridge } from './pod-a2a-bridge';

/**
 * A2A TaskStore adapter. Pod task is authoritative; save/load are projections.
 * Mutations must go through PodA2ABridge, never through the A2A store.
 */
export class PodA2ATaskStore implements TaskStore {
  constructor(private readonly deps: { bridge: PodA2ABridge; podId: string }) {}

  async save(_task: Task, _context: ServerCallContext): Promise<void> {
    // Pod task state is authoritative; A2A writes are ignored.
  }

  async load(taskId: string, _context: ServerCallContext): Promise<Task | undefined> {
    return this.deps.bridge.getTask(this.deps.podId, taskId) ?? undefined;
  }

  async list(_params: ListTasksRequest, _context: ServerCallContext): Promise<ListTasksResponse> {
    return { tasks: [] } as unknown as ListTasksResponse;
  }
}
